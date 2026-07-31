/**
 * 债务还款计算引擎（从 life-manager core/finance.py 移植为纯 TS）。
 *
 * 支持 4 种还款方式：
 *  - equal_installment 等额本息
 *  - equal_principal   等额本金
 *  - equal_interest    等本等息（每期本金相等、利息按原始本金固定计，月供恒定）
 *  - interest_first    先息后本
 *
 * 额外支持：
 *  - 分段利率：rate_adjustments（生效日 + 新利率）
 *  - 利率类型：benchmark / lpr → 有效年利率 = base_rate + rate_spread；fixed → 用 annualRate
 *  - 提前还款：prepayments（日期 + 金额 + 类型 reduce_term/reduce_payment）
 *
 * 纯函数、无 DB 依赖，便于单测。所有金额保留 2 位小数。
 */

export type RepaymentMethod =
  | 'equal_installment'
  | 'equal_principal'
  | 'equal_interest'
  | 'interest_first';

export interface RateAdjustment {
  effectiveDate: string; // ISO date (YYYY-MM-DD)
  newRate: number; // 年利率 %
}

export interface Prepayment {
  date: string; // ISO date
  amount: number;
  type?: 'reduce_term' | 'reduce_payment';
}

/**
 * 重定价规则（P0-1）：引擎据此自动生成 rateAdjustments，无需用户逐期手填。
 * - benchmark：挂钩基准（LPR_1Y / LPR_5Y / PBOC_BASE）
 * - spread：加点（百分点），签约时锁定、永久不变
 * - cycleMonths：重定价周期（12=年 / 6=半年 / 3=季）
 * - anchor：对年对月对日(anniversary) 或 固定日历日(fixed_date)
 */
export interface RepricingRule {
  benchmark: 'LPR_1Y' | 'LPR_5Y' | 'PBOC_BASE';
  spread: number;
  cycleMonths: number;
  anchor: 'anniversary' | 'fixed_date';
  fixedDate?: string;
}

/** 参考用 LPR 历史（生效日 → 利率%）。无法联网取数时作为内置基准；可随央行公布更新。 */
const LPR_HISTORY: Record<'LPR_1Y' | 'LPR_5Y', { date: string; rate: number }[]> = {
  LPR_1Y: [
    { date: '2022-01-01', rate: 3.7 },
    { date: '2023-01-01', rate: 3.65 },
    { date: '2024-01-01', rate: 3.45 },
    { date: '2024-07-01', rate: 3.35 },
    { date: '2025-01-01', rate: 3.1 },
    { date: '2025-07-01', rate: 3.0 },
    { date: '2026-01-01', rate: 2.9 },
  ],
  LPR_5Y: [
    { date: '2022-01-01', rate: 4.6 },
    { date: '2023-01-01', rate: 4.3 },
    { date: '2024-01-01', rate: 4.2 },
    { date: '2024-07-01', rate: 3.95 },
    { date: '2025-01-01', rate: 3.6 },
    { date: '2025-07-01', rate: 3.5 },
    { date: '2026-01-01', rate: 3.4 },
  ],
};
const PBOC_BASE_RATE = 4.3; // 央行基准利率（参考）

/** 取某基准在给定日期生效的利率（取不晚于该日的最近一条历史） */
function benchmarkRateAt(benchmark: RepricingRule['benchmark'], onDate: string): number {
  if (benchmark === 'PBOC_BASE') return PBOC_BASE_RATE;
  const hist = LPR_HISTORY[benchmark];
  let rate = hist[0]?.rate ?? 0;
  for (const h of hist) {
    if (h.date <= onDate) rate = h.rate;
    else break;
  }
  return rate;
}

/**
 * 由重定价规则生成 (生效日, 新利率) 列表。
 * 重定价日按 anchor 推算：
 *  - anniversary：起贷日的每月/每年/每季对日
 *  - fixed_date：固定日历日（如每年 1 月 1 日）的对日
 * 每个重定价日取「当日基准 + 锁定加点」作为新执行利率。
 */
export function generateRepricingAdjustments(
  rule: RepricingRule,
  startDate: string,
  termMonths: number,
): RateAdjustment[] {
  const s = ymd(startDate);
  const cycle = Math.max(1, Math.min(12, rule.cycleMonths));
  const out: RateAdjustment[] = [];
  const base: { y: number; m: number; d: number } =
    rule.anchor === 'fixed_date' && rule.fixedDate
      ? (() => {
          const p = rule.fixedDate.slice(0, 10).split('-').map(Number);
          return { y: p[0] ?? s.y, m: p[1] ?? 1, d: p[2] ?? 1 };
        })()
      : { y: s.y, m: s.m, d: 1 };

  for (let monthIdx = cycle; monthIdx <= termMonths; monthIdx += cycle) {
    // 起贷日后第 monthIdx 个月对应的重定价日
    let y = base.y;
    let m = base.m + monthIdx;
    while (m > 12) {
      m -= 12;
      y += 1;
    }
    const day = rule.anchor === 'fixed_date' ? base.d : s.d;
    const eff = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const rate = round2(benchmarkRateAt(rule.benchmark, eff) + rule.spread);
    out.push({ effectiveDate: eff, newRate: rate });
  }
  return out;
}

export interface DebtCalcInput {
  principal: number;
  /** 年化利率 %（对应原 apr 字段） */
  annualRate: number;
  /** 还款期数（月） */
  termMonths: number;
  repaymentMethod: RepaymentMethod;
  /** 起贷日 ISO（YYYY-MM-DD 或完整 ISO） */
  startDate: string;
  rateType?: 'benchmark' | 'lpr' | 'fixed' | null;
  baseRate?: number | null;
  rateSpread?: number | null;
  /** 利率重定价记录：数组或 JSON 字符串 */
  rateAdjustments?: RateAdjustment[] | string | null;
  /** 重定价规则（P0-1）：存在时自动生成 rateAdjustments，优先级高于上面的手填列表 */
  repricing?: RepricingRule | string | null;
  /** 提前还款记录：数组或 JSON 字符串 */
  prepayments?: Prepayment[] | string | null;
}

export interface ScheduleRow {
  month: number;
  payment: number;
  principal: number;
  interest: number;
  remaining: number;
  rate: number;
  prepayment: number | null;
}

export interface DebtSummary {
  principal: number;
  annualRate: number;
  effectiveRate: number;
  termMonths: number;
  repaymentMethod: RepaymentMethod;
  startDate: string;
  monthlyPayment: number;
  remainingPrincipal: number;
  paidMonths: number;
  totalMonths: number;
  progress: number;
  /** 本金偿还进度（已还本金 / 原始本金） */
  principalProgress: number;
  totalInterest: number;
  totalPayment: number;
  currentRate: number;
  /** 实际年化利率(IRR/EAR)%，反映真实资金成本 */
  irr: number;
  /** 因提前还款节省的利息总额 */
  interestSaved: number;
  /** 因提前还款缩短的期数 */
  termShortened: number;
}

function monthlyRate(annualRatePct: number): number {
  return annualRatePct / 100 / 12;
}

function parseRateAdjustments(raw: RateAdjustment[] | string | null | undefined): RateAdjustment[] {
  if (!raw) return [];
  let arr: RateAdjustment[];
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  } else {
    arr = raw;
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((a) => a && typeof a.effectiveDate === 'string' && typeof a.newRate === 'number')
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
}

function parsePrepayments(raw: Prepayment[] | string | null | undefined): Prepayment[] {
  if (!raw) return [];
  let arr: Prepayment[];
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  } else {
    arr = raw;
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((p) => p && typeof p.date === 'string' && typeof p.amount === 'number')
    .sort((a, b) => a.date.localeCompare(b.date));
}

function parseRepricing(raw: DebtCalcInput['repricing']): RepricingRule | null {
  if (!raw) return null;
  let obj: RepricingRule;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  } else {
    obj = raw;
  }
  if (!obj || !obj.benchmark || obj.cycleMonths == null) return null;
  return obj;
}

/**
 * 解析最终生效的利率重定价列表：若设置了重定价规则则自动派生，否则用手填列表。
 */
function resolveRateAdjustments(input: DebtCalcInput): RateAdjustment[] {
  const rule = parseRepricing(input.repricing);
  if (rule && input.termMonths > 0) {
    return generateRepricingAdjustments(rule, input.startDate, input.termMonths);
  }
  return parseRateAdjustments(input.rateAdjustments);
}

/** 取 ISO 的 YYYY-MM-DD 部分（避免时区漂移） */
function ymd(iso: string): { y: number; m: number; d: number } {
  const s = iso.slice(0, 10);
  const parts = s.split('-').map(Number);
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  const d = parts[2] ?? 1;
  return { y, m, d };
}

function monthsBetween(startIso: string, endIso: string): number {
  const a = ymd(startIso);
  const b = ymd(endIso);
  return (b.y - a.y) * 12 + (b.m - a.m);
}

function rateForMonthStart(
  startIso: string,
  monthIdx: number,
  defaultRate: number,
  adjustments: RateAdjustment[],
): number {
  if (!adjustments.length) return defaultRate;
  const s = ymd(startIso);
  let y = s.y;
  let m = s.m + monthIdx;
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  const monthDateStr = `${y}-${String(m).padStart(2, '0')}-01`;
  let current = defaultRate;
  for (const adj of adjustments) {
    if (adj.effectiveDate <= monthDateStr) current = adj.newRate;
  }
  return current;
}

function getEffectiveAnnualRate(input: DebtCalcInput): number {
  const rt = input.rateType;
  if (rt === 'lpr' || rt === 'benchmark') {
    const base = input.baseRate ?? 0;
    const spread = input.rateSpread ?? 0;
    return base + spread;
  }
  return input.annualRate;
}

/* ── 等额本息 ── */
function calcEqualInstallment(
  principal: number,
  startRate: number,
  termMonths: number,
  startIso: string,
  adjustments: RateAdjustment[],
  prepayments: Prepayment[],
): ScheduleRow[] {
  const schedule: ScheduleRow[] = [];
  let remaining = principal;
  let month = 0;
  let monthlyPayment = 0;

  while (month < termMonths && remaining > 0.01) {
    month += 1;
    const annualRate = rateForMonthStart(startIso, month - 1, startRate, adjustments);
    const r = monthlyRate(annualRate);

    const prepay = prepayments.find(
      (p) => monthsBetween(startIso, p.date) === month - 1,
    );
    let prepayAmount = 0;

    let rateChanged = false;
    if (month > 1) {
      const prevRate = rateForMonthStart(startIso, month - 2, startRate, adjustments);
      if (Math.abs(prevRate - annualRate) > 0.0001) rateChanged = true;
    }

    if (prepay) {
      prepayAmount = Math.min(prepay.amount, remaining);
      remaining -= prepayAmount;
      if (
        (prepay.type === 'reduce_term' || prepay.type === 'reduce_payment') &&
        remaining > 0.01
      ) {
        const remainingTerm = termMonths - month;
        if (remainingTerm > 0 && r > 0) {
          monthlyPayment =
            (remaining * r * Math.pow(1 + r, remainingTerm)) /
            (Math.pow(1 + r, remainingTerm) - 1);
        } else if (remainingTerm > 0) {
          monthlyPayment = remaining / remainingTerm;
        } else {
          monthlyPayment = remaining;
        }
      }
    } else if (month === 1 || rateChanged) {
      const remainingTerm = termMonths - month + 1;
      if (r > 0) {
        monthlyPayment =
          (remaining * r * Math.pow(1 + r, remainingTerm)) /
          (Math.pow(1 + r, remainingTerm) - 1);
      } else {
        monthlyPayment = remaining / remainingTerm;
      }
    }

    const interest = remaining * r;
    let paidPrincipal = monthlyPayment - interest;
    if (paidPrincipal > remaining) {
      paidPrincipal = remaining;
      monthlyPayment = paidPrincipal + interest;
    }
    remaining -= paidPrincipal;
    if (remaining < 0.01) remaining = 0;

    schedule.push({
      month,
      payment: round2(monthlyPayment),
      principal: round2(paidPrincipal),
      interest: round2(interest),
      remaining: round2(remaining),
      rate: annualRate,
      prepayment: prepay ? round2(prepayAmount) : null,
    });
  }
  return schedule;
}

/* ── 等额本金 ── */
function calcEqualPrincipal(
  principal: number,
  startRate: number,
  termMonths: number,
  startIso: string,
  adjustments: RateAdjustment[],
  prepayments: Prepayment[],
): ScheduleRow[] {
  const schedule: ScheduleRow[] = [];
  let remaining = principal;
  let monthlyPrincipal = principal / termMonths;

  for (let month = 1; month <= termMonths; month += 1) {
    if (remaining <= 0.01) break;
    const annualRate = rateForMonthStart(startIso, month - 1, startRate, adjustments);
    const r = monthlyRate(annualRate);

    const prepay = prepayments.find((p) => monthsBetween(startIso, p.date) === month - 1);
    let prepayAmount = 0;
    if (prepay) {
      prepayAmount = Math.min(prepay.amount, remaining);
      remaining -= prepayAmount;
      const remainingMonths = termMonths - month;
      if (remainingMonths > 0) monthlyPrincipal = remaining / remainingMonths;
    }

    const thisPrincipal = Math.min(monthlyPrincipal, remaining);
    const interest = remaining * r;
    const payment = thisPrincipal + interest;
    remaining -= thisPrincipal;
    if (remaining < 0.01) remaining = 0;

    schedule.push({
      month,
      payment: round2(payment),
      principal: round2(thisPrincipal),
      interest: round2(interest),
      remaining: round2(remaining),
      rate: annualRate,
      prepayment: prepay ? round2(prepayAmount) : null,
    });
  }
  return schedule;
}

/* ── 先息后本 ── */
function calcInterestFirst(
  principal: number,
  startRate: number,
  termMonths: number,
  startIso: string,
  adjustments: RateAdjustment[],
  prepayments: Prepayment[],
): ScheduleRow[] {
  const schedule: ScheduleRow[] = [];
  let remaining = principal;

  for (let month = 1; month <= termMonths; month += 1) {
    if (remaining <= 0.01) break;
    const annualRate = rateForMonthStart(startIso, month - 1, startRate, adjustments);
    const r = monthlyRate(annualRate);

    const prepay = prepayments.find((p) => monthsBetween(startIso, p.date) === month - 1);
    let prepayAmount = 0;
    if (prepay) {
      prepayAmount = Math.min(prepay.amount, remaining);
      remaining -= prepayAmount;
    }

    const interest = remaining * r;
    let payment: number;
    let paidPrincipal: number;
    if (month === termMonths || remaining <= 0.01) {
      payment = interest + remaining;
      paidPrincipal = remaining;
      remaining = 0;
    } else {
      payment = interest;
      paidPrincipal = 0;
    }

    schedule.push({
      month,
      payment: round2(payment),
      principal: round2(paidPrincipal),
      interest: round2(interest),
      remaining: round2(remaining),
      rate: annualRate,
      prepayment: prepay ? round2(prepayAmount) : null,
    });
  }
  return schedule;
}

/* ── 等本等息：每期本金相等(P/N)，利息按原始本金固定计算(P×月利率)，月供恒定 ── */
function calcEqualInterest(
  principal: number,
  startRate: number,
  termMonths: number,
  startIso: string,
  _adjustments: RateAdjustment[],
  prepayments: Prepayment[],
): ScheduleRow[] {
  const schedule: ScheduleRow[] = [];
  let remaining = principal;
  const monthlyPrincipal = principal / termMonths;
  const baseInterest = principal * monthlyRate(startRate); // 按原始本金计，恒定

  for (let month = 1; month <= termMonths; month += 1) {
    if (remaining <= 0.01) break;
    const prepay = prepayments.find((p) => monthsBetween(startIso, p.date) === month - 1);
    let prepayAmount = 0;
    if (prepay) {
      prepayAmount = Math.min(prepay.amount, remaining);
      remaining -= prepayAmount;
    }

    let thisPrincipal = Math.min(monthlyPrincipal, remaining);
    if (remaining - thisPrincipal <= 0.01) {
      thisPrincipal = remaining;
      remaining = 0;
    } else {
      remaining -= thisPrincipal;
    }
    // 等本等息特征：利息始终基于原始本金，不随余额递减
    const interest = baseInterest;
    schedule.push({
      month,
      payment: round2(thisPrincipal + interest),
      principal: round2(thisPrincipal),
      interest: round2(interest),
      remaining: round2(remaining),
      rate: startRate,
      prepayment: prepay ? round2(prepayAmount) : null,
    });
  }
  return schedule;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 根据债务输入生成完整还款计划（含利率重定价 + 提前还款） */
export function getRepaymentSchedule(input: DebtCalcInput): ScheduleRow[] {
  const adjustments = resolveRateAdjustments(input);
  const prepayments = parsePrepayments(input.prepayments);
  const effectiveRate = getEffectiveAnnualRate(input);
  const method = input.repaymentMethod || 'equal_installment';
  const term = input.termMonths || 0;

  if (term <= 0) return [];

  switch (method) {
    case 'equal_principal':
      return calcEqualPrincipal(input.principal, effectiveRate, term, input.startDate, adjustments, prepayments);
    case 'interest_first':
      return calcInterestFirst(input.principal, effectiveRate, term, input.startDate, adjustments, prepayments);
    case 'equal_interest':
      return calcEqualInterest(input.principal, effectiveRate, term, input.startDate, adjustments, prepayments);
    case 'equal_installment':
    default:
      return calcEqualInstallment(input.principal, effectiveRate, term, input.startDate, adjustments, prepayments);
  }
}

/** 债务摘要：当前剩余本金、已还期数、进度、月供、总利息、当前利率 */
export function getDebtSummary(input: DebtCalcInput): DebtSummary {
  const effectiveRate = getEffectiveAnnualRate(input);
  const term = input.termMonths || 0;
  const schedule = getRepaymentSchedule(input);

  const now = new Date();
  const s = ymd(input.startDate);
  let monthsElapsed = (now.getFullYear() - s.y) * 12 + (now.getMonth() + 1 - s.m);
  if (monthsElapsed < 0) monthsElapsed = 0;
  if (monthsElapsed > schedule.length) monthsElapsed = schedule.length;

  const totalInterest = schedule.reduce((sum, r) => sum + r.interest, 0);
  const totalPayment = schedule.reduce((sum, r) => sum + r.payment + (r.prepayment ?? 0), 0);

  // 剩余本金 = 已完成 monthsElapsed 期扣款后的未偿余额。
  // schedule 为 0 基索引：schedule[k].remaining 是「第 k+1 期扣款后」的余额，
  // 故已完成 monthsElapsed 期对应 schedule[monthsElapsed-1]（0 期时等于原始本金）。
  const remainingPrincipal =
    schedule.length > 0
      ? monthsElapsed <= 0
        ? input.principal
        : schedule[monthsElapsed - 1]!.remaining
      : input.principal;
  const monthlyPayment =
    schedule.length > 0 ? schedule[Math.min(monthsElapsed, schedule.length - 1)]!.payment : 0;
  const currentRate =
    schedule.length > 0 ? (monthsElapsed < schedule.length ? schedule[monthsElapsed]!.rate : effectiveRate) : effectiveRate;

  const progress = term > 0 ? monthsElapsed / term : 0;
  // 本金偿还进度（已还本金 / 原始本金）：反映真实「已还」比例，区别于期数时间进度。
  const principalProgress = input.principal > 0 ? (input.principal - remainingPrincipal) / input.principal : 0;

  // —— P1-1 实际年化(IRR/EAR) ——
  // 现金流：t0 流出本金；随后每月流出(月供 + 当月提前还款额)；用二分法求月度 IRR，再年化。
  const irr = computeIrr(input, schedule, monthlyPayment);

  // —— P1-2 提前还款收益 ——
  // 基准：无提前还款的还款计划；对比实际计划，得出节省利息与缩短期数。
  let interestSaved = 0;
  let termShortened = 0;
  if (parsePrepayments(input.prepayments).length > 0) {
    const baseline = getRepaymentSchedule({ ...input, prepayments: [] });
    const baselineInterest = baseline.reduce((s, r) => s + r.interest, 0);
    interestSaved = round2(Math.max(0, baselineInterest - totalInterest));
    termShortened = Math.max(0, baseline.length - schedule.length);
  }

  return {
    principal: input.principal,
    annualRate: input.annualRate,
    effectiveRate,
    termMonths: term,
    repaymentMethod: input.repaymentMethod || 'equal_installment',
    startDate: input.startDate.slice(0, 10),
    monthlyPayment: round2(monthlyPayment),
    remainingPrincipal: round2(remainingPrincipal),
    paidMonths: monthsElapsed,
    totalMonths: term,
    progress: Math.max(0, Math.min(1, progress)),
    principalProgress: Math.max(0, Math.min(1, principalProgress)),
    totalInterest: round2(totalInterest),
    totalPayment: round2(totalPayment),
    currentRate,
    irr: round2(irr),
    interestSaved,
    termShortened,
  };
}

/**
 * 月度 IRR（内部收益率，借款人视角真实资金成本）：
 * 现金流 c[0]=+principal（取得借款），c[m]=-(月供 + 当月实际提前还款额)。
 * 用二分法在 [-0.9, 1.0] 月度区间求解 NPV=0；再年化 EAR=(1+irr)^12-1。
 * 等额本息下 EAR 会高于名义年利率，正确反映「资金被按月占用」的真实成本。
 */
function computeIrr(input: DebtCalcInput, schedule: ScheduleRow[], monthlyPayment: number): number {
  if (input.principal <= 0 || schedule.length === 0) return 0;
  // 借款人视角现金流：t0 收到本金(+)，其后每月还本付息(-)。IRR 即真实资金成本（年化后为 EAR）。
  const cf: number[] = [input.principal];
  for (const r of schedule) {
    cf.push(-(r.payment + (r.prepayment ?? 0)));
  }
  const npv = (rate: number) => cf.reduce((acc, c, i) => acc + c / Math.pow(1 + rate, i), 0);

  let lo = -0.9;
  let hi = 1.0;
  let fLo = npv(lo);
  let fHi = npv(hi);
  if (fLo * fHi > 0) return 0; // 无符号变化，IRR 不可解
  for (let i = 0; i < 100; i += 1) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-6) {
      lo = hi = mid;
      break;
    }
    if (fLo * fMid < 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  const monthlyIrr = (lo + hi) / 2;
  if (monthlyIrr <= -1) return 0;
  const ear = (Math.pow(1 + monthlyIrr, 12) - 1) * 100;
  return Math.max(0, Math.min(100, ear));
}
