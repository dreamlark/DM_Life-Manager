// 个人财务 → 家庭共享：共享项类型 + 快照构建器。
// 设计见 docs/finance-share-design.md。server 仅存快照，不回源 engine，故快照必须是「自包含的数值」。

export type SharedFinanceItemType =
  | 'summary'
  | 'income'
  | 'expense'
  | 'asset'
  | 'debt'
  | 'investment'
  | 'budget';

export type SharedFinanceScope = 'all' | 'specific';

export interface FinanceSnapshot {
  value: number;
  currency: 'CNY';
  period: string; // YYYY-MM
  breakdown?: { label: string; value: number }[];
  updatedAt: string;
}

/** 配置面板左池的一个候选共享项（来自个人财务数据） */
export interface ShareCandidate {
  itemType: SharedFinanceItemType;
  itemKey: string;
  label: string;
  group: string; // 分组标题
}

/** 已选中的共享项（含权限范围） */
export interface SelectedShareItem {
  itemType: SharedFinanceItemType;
  itemKey: string;
  label: string;
  scope: SharedFinanceScope;
  allowedUserIds: string[];
}

/** server 返回的共享项视图（snapshot 由 z.any() 推断，前端按 any 处理） */
export interface SharedFinanceItemView {
  id: string;
  familyId: string;
  ownerUserId: string;
  itemType: SharedFinanceItemType;
  itemKey: string;
  label: string;
  scope: SharedFinanceScope;
  allowedUserIds: string[];
  snapshot: any;
  updatedAt: string;
}

const periodNow = () => new Date().toISOString().slice(0, 7);
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const money = (n: number): string => `¥${num(n).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`;

// ===== 快照构建器（每项一组，取值防御式，避免字段缺失导致整条推送失败） =====

export function buildSummarySnapshot(s: any): FinanceSnapshot {
  const netWorth = num(s?.netWorth);
  const totalAssets = num(s?.totalAssets);
  const totalDebt = num(s?.totalDebt);
  const monthIncome = num(s?.monthIncome ?? s?.monthlyIncome);
  const monthExpense = num(s?.monthExpense ?? s?.monthlyDebtPayment);
  return {
    value: netWorth,
    currency: 'CNY',
    period: periodNow(),
    breakdown: [
      { label: '净资产', value: netWorth },
      { label: '总资产', value: totalAssets },
      { label: '总负债', value: totalDebt },
      { label: '本月收入', value: monthIncome },
      { label: '本月支出', value: monthExpense },
    ],
    updatedAt: new Date().toISOString(),
  };
}

export function buildIncomeSnapshot(income: any): FinanceSnapshot {
  return {
    value: num(income?.amount),
    currency: 'CNY',
    period: periodNow(),
    breakdown: [{ label: income?.name ?? '收入', value: num(income?.amount) }],
    updatedAt: new Date().toISOString(),
  };
}

export function buildAssetSnapshot(asset: any): FinanceSnapshot {
  return {
    value: num(asset?.value),
    currency: 'CNY',
    period: periodNow(),
    breakdown: [{ label: asset?.name ?? '资产', value: num(asset?.value) }],
    updatedAt: new Date().toISOString(),
  };
}

export function buildDebtSnapshot(debt: any): FinanceSnapshot {
  const remaining = num(debt?.remainingPrincipal ?? debt?.remaining ?? debt?.balance ?? debt?.principal);
  return {
    value: remaining,
    currency: 'CNY',
    period: periodNow(),
    breakdown: [{ label: debt?.creditor ?? debt?.name ?? '债务', value: remaining }],
    updatedAt: new Date().toISOString(),
  };
}

export function buildExpenseSnapshot(category: string, total: number): FinanceSnapshot {
  return {
    value: total,
    currency: 'CNY',
    period: periodNow(),
    breakdown: [{ label: category, value: total }],
    updatedAt: new Date().toISOString(),
  };
}

export function buildBudgetSnapshot(budget: any): FinanceSnapshot {
  const limit = num(budget?.monthlyLimit);
  const spent = num(budget?.spent);
  return {
    value: spent,
    currency: 'CNY',
    period: periodNow(),
    breakdown: [
      { label: '月度限额', value: limit },
      { label: '已花费', value: spent },
      { label: '剩余', value: num(budget?.remaining) },
    ],
    updatedAt: new Date().toISOString(),
  };
}

/** 汇总本地财务数据，产出左池候选项（含预算/投资子类） */
export function buildCandidates(bag: {
  summary?: any;
  incomes?: any[];
  assets?: any[];
  debts?: any[];
  transactions?: any[];
  budgets?: any[];
}): ShareCandidate[] {
  const out: ShareCandidate[] = [];

  out.push({ itemType: 'summary', itemKey: '*', label: '家庭财务总览', group: '总览' });

  for (const inc of bag.incomes ?? []) {
    const label = inc.source ? `${inc.source} · ${money(inc.amount)}` : '收入';
    out.push({ itemType: 'income', itemKey: String(inc.id), label, group: '收入' });
  }
  for (const a of bag.assets ?? []) {
    const isInvest = (a.assetClass ?? a.type) === 'investment';
    const label = a.name ? `${a.name} · ${money(a.value)}` : isInvest ? '投资' : '资产';
    out.push({
      itemType: isInvest ? 'investment' : 'asset',
      itemKey: String(a.id),
      label,
      group: isInvest ? '投资' : '资产',
    });
  }
  for (const d of bag.debts ?? []) {
    const remaining = num(d.remainingPrincipal ?? d.principal);
    const label = d.creditor ? `${d.creditor} · ${money(remaining)}` : '债务';
    out.push({ itemType: 'debt', itemKey: String(d.id), label, group: '债务' });
  }

  // 支出按类别聚合
  const byCat = new Map<string, number>();
  for (const t of bag.transactions ?? []) {
    if (t.kind !== 'expense') continue;
    const cat = t.category || '其他';
    byCat.set(cat, (byCat.get(cat) ?? 0) + num(t.amount));
  }
  for (const [cat, total] of byCat) {
    out.push({ itemType: 'expense', itemKey: cat, label: `支出·${cat}`, group: '支出' });
  }

  for (const b of bag.budgets ?? []) {
    out.push({ itemType: 'budget', itemKey: String(b.id), label: b.name ?? '预算', group: '预算' });
  }

  return out;
}

/** 根据候选项与个人数据，构建某项的快照（供保存/重推使用） */
export function snapshotFor(
  sel: { itemType: SharedFinanceItemType; itemKey: string },
  bag: {
    summary?: any;
    incomes?: any[];
    assets?: any[];
    debts?: any[];
    transactions?: any[];
    budgets?: any[];
  },
): FinanceSnapshot {
  const find = (arr: any[] | undefined, key: string) => (arr ?? []).find((x) => String(x.id) === key);
  switch (sel.itemType) {
    case 'summary':
      return buildSummarySnapshot(bag.summary);
    case 'income':
      return buildIncomeSnapshot(find(bag.incomes, sel.itemKey));
    case 'asset':
    case 'investment': {
      const a = find(bag.assets, sel.itemKey);
      return buildAssetSnapshot(a ?? { name: sel.itemKey, value: 0 });
    }
    case 'debt':
      return buildDebtSnapshot(find(bag.debts, sel.itemKey));
    case 'budget':
      return buildBudgetSnapshot(find(bag.budgets, sel.itemKey));
    case 'expense': {
      const total = (bag.transactions ?? [])
        .filter((t) => t.kind === 'expense' && (t.category || '其他') === sel.itemKey)
        .reduce((s, t) => s + num(t.amount), 0);
      return buildExpenseSnapshot(sel.itemKey, total);
    }
    default:
      return { value: 0, currency: 'CNY', period: periodNow(), updatedAt: new Date().toISOString() };
  }
}
