// 压力测试套件（Standard/Exhaustive）—— 覆盖认证/PIN 爆破、多用户隔离与 IDOR、任务批量与每日例行膨胀、
// 财务批量与转账幂等、笔记大内容与 XSS 存储边界、限流桶内存防护。
// 全部通过 appRouter.createCaller 进程内调用，避免 HTTP 开销；/health 与 /api/version 的并发由 scripts/stress-http.mjs 覆盖。
/// <reference types="vitest" />
import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { appRouter, __rateBucketCount, __sweepRateBuckets, rateLimited } from '../router';
import { initDb, closeDb } from '../db';
import { store } from '../store';
import type { AuthContext } from '../rbac';

const anon = (ip?: string) => appRouter.createCaller({ userId: null, ip } as AuthContext);
const asUser = (userId: string, ip?: string) => appRouter.createCaller({ userId, ip } as AuthContext);

async function register(email: string, password = 'secret1') {
  const reg = await anon().auth.register({ email, name: 'u', password });
  return { userId: reg.user.id, me: asUser(reg.user.id) };
}

/** 分块并发执行，控制单批并发度，避免一次性 Promise.all 把 PGLite 打满 */
async function chunked<T>(items: T[], size: number, fn: (item: T, i: number) => Promise<unknown>) {
  for (let i = 0; i < items.length; i += size) {
    const slice = items.slice(i, i + size);
    await Promise.all(slice.map((it, j) => fn(it, i + j)));
  }
}

const t0 = () => Date.now();
const ms = (s: number) => `${Date.now() - s}ms`;

beforeEach(async () => {
  await initDb();
  await store.reset();
});
afterAll(async () => {
  await closeDb();
});

describe('压力 · 认证 / PIN 爆破与限流', () => {
  it(
    '60 次错误密码登录均返回 UNAUTHORIZED 且进程不崩溃',
    async () => {
      await register('brute@home.dev');
      const start = t0();
      let ok = 0;
      let unauth = 0;
      // 注意：bcrypt 成本 10 使每次错误比对约 100-120ms，慢本身即对抗在线爆破的纵深防御。
      // 不同环境耗时差异大，故用例数取较小值并放宽超时；限流阈值（生产 20/10min/IP）由 rate-limit.test.ts 覆盖。
      await chunked(Array.from({ length: 60 }), 20, async (_, i) => {
        try {
          await anon(`1.1.1.${i % 250}`).auth.login({ email: 'brute@home.dev', password: `wrong-${i}` });
          ok++;
        } catch (e) {
          if (String((e as Error).message).includes('邮箱或密码错误')) unauth++;
        }
      });
      console.log(`[auth-brute] 60 次错误登录耗时 ${ms(start)}（成功 ${ok} / 拒绝 ${unauth}）`);
      expect(ok).toBe(0);
      expect(unauth).toBe(60);
    },
    60000,
  );

  it('限流桶随过期自动清理，避免独立 IP 导致内存膨胀（分布式爆破防护）', async () => {
    // rateBuckets 是模块级单例，跨同 worker 内的用例共享；用增量断言避免被其他用例的桶污染。
    const before = __rateBucketCount();
    for (let i = 0; i < 4000; i++) {
      expect(rateLimited(`rl:login:sweep-${i}`, 100000, 30)).toBe(false);
    }
    const mid = __rateBucketCount();
    await new Promise((r) => setTimeout(r, 60)); // 等待 30ms 滑动窗口过期
    const removed = __sweepRateBuckets();
    const after = __rateBucketCount();
    console.log(`[ratelimit-sweep] 基线 ${before} → +4000=${mid}，过期清理 ${removed}，剩余 ${after}`);
    expect(mid).toBe(before + 4000); // 本测试新写入 4000 个独立 IP 桶
    expect(removed).toBe(4000); // 仅清理过期的（本测试 30ms 窗口桶全部过期）；其他用例的 10min 窗口桶保留
    expect(after).toBe(before); // 清理后回到基线（未过期桶不受影响）
  });
});

describe('压力 · 多用户隔离与 IDOR', () => {
  it('并发双用户各写 100 任务，互不串读（个人域 familyId 服务端派生）', async () => {
    const a = await register('isoA@home.dev');
    const b = await register('isoB@home.dev');
    const start = t0();
    await Promise.all(
      Array.from({ length: 100 }, async (_, i) => {
        await a.me.tasks.create({ title: `A-${i}`, domainKey: 'work' });
        await b.me.tasks.create({ title: `B-${i}`, domainKey: 'work' });
      }),
    );
    const aList = await a.me.tasks.all();
    const bList = await b.me.tasks.all();
    console.log(`[isolation] 双用户各 100 并发写入耗时 ${ms(start)}；A 见 ${aList.length} / B 见 ${bList.length}`);
    expect(aList).toHaveLength(100);
    expect(bList).toHaveLength(100);
    expect(aList.every((t) => t.title.startsWith('A-'))).toBe(true);
    expect(bList.every((t) => t.title.startsWith('B-'))).toBe(true);
    expect(aList.some((t) => t.title.startsWith('B-'))).toBe(false);
  });

  it('IDOR：用户 B 用 A 的任务 id 调用 complete 不影响 A 的数据', async () => {
    const a = await register('idorA@home.dev');
    const b = await register('idorB@home.dev');
    const aTask = await a.me.tasks.create({ title: 'A 私密任务', domainKey: 'work' });
    try {
      await b.me.tasks.complete({ id: aTask.id });
    } catch {
      /* 不论是否抛错，A 的任务都不应被改动 */
    }
    const aReload = (await a.me.tasks.all()).find((t) => t.id === aTask.id);
    console.log(`[idor] B 越权 complete(A.task)，A 任务状态仍为 ${aReload?.status}`);
    expect(aReload).toBeTruthy();
    expect(aReload?.status).toBe('todo');
  });
});

describe('压力 · 任务批量与每日例行膨胀', () => {
  it('批量创建 500 任务（分块并发）全部可读', async () => {
    const { me } = await register('batch@home.dev');
    const start = t0();
    await chunked(Array.from({ length: 500 }), 50, (_, i) =>
      me.tasks.create({ title: `T-${i}`, domainKey: 'work' }),
    );
    const all = await me.tasks.all();
    console.log(`[tasks-batch] 500 任务写入+读回耗时 ${ms(start)}，实际 ${all.length}`);
    expect(all).toHaveLength(500);
  });

  it('ensureDaily 幂等：同日期重复调用不重复生成实例', async () => {
    const { me } = await register('daily@home.dev');
    await chunked(Array.from({ length: 10 }), 10, (_, i) =>
      me.tasks.create({ title: `模板-${i}`, domainKey: 'work', repeat: 'daily' }),
    );
    const date = '2026-08-01';
    await me.tasks.ensureDaily({ date });
    await me.tasks.ensureDaily({ date });
    const instances = (await me.tasks.all()).filter((t) => t.sourceDailyId);
    console.log(`[daily-idem] 10 模板 × 同日 ensureDaily×2 → 实例 ${instances.length}（期望 10）`);
    expect(instances).toHaveLength(10);
  });

  it('每日例行跨 30 天膨胀规模可控', async () => {
    const { me } = await register('daily30@home.dev');
    await chunked(Array.from({ length: 10 }), 10, (_, i) =>
      me.tasks.create({ title: `模板-${i}`, domainKey: 'work', repeat: 'daily' }),
    );
    const start = t0();
    for (let d = 1; d <= 30; d++) {
      const date = `2026-09-${String(d).padStart(2, '0')}`;
      await me.tasks.ensureDaily({ date });
    }
    const instances = (await me.tasks.all()).filter((t) => t.sourceDailyId);
    console.log(`[daily-explode] 10 模板 × 30 天 → 实例 ${instances.length}，耗时 ${ms(start)}`);
    expect(instances).toHaveLength(300);
  });
});

describe('压力 · 财务批量与转账幂等', () => {
  it('批量录入 1000 条流水（分块并发）无报错', async () => {
    const { me } = await register('fin@home.dev');
    const start = t0();
    await chunked(Array.from({ length: 1000 }), 50, (_, i) =>
      me.finance.transactions.record({
        kind: i % 2 === 0 ? 'expense' : 'income',
        category: '压力测试',
        amount: 100 + i,
        occurredAt: new Date().toISOString(),
      }),
    );
    const all = await me.finance.transactions.list();
    console.log(`[fin-batch] 1000 流水写入+读回耗时 ${ms(start)}，实际 ${all.length}`);
    expect(all).toHaveLength(1000);
  });

  it('转账幂等：20 并发重复提交同一 idempotency_key 仅生成一条（无双花）', async () => {
    const { me } = await register('transfer@home.dev');
    const key = 'idem-stress-001';
    const start = t0();
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        me.finance.transfers.create({
          fromAccountId: 'acct-from',
          toAccountId: 'acct-to',
          amountMinor: 5000,
          occurredAt: new Date().toISOString(),
          idempotencyKey: key,
        }),
      ),
    );
    const fulfilled = results.filter((r) => r.status === 'fulfilled') as Array<{ value: { id: string } }>;
    const list = await me.finance.transfers.list({ limit: 100, offset: 0 });
    const ids = new Set(fulfilled.map((r) => r.value.id));
    console.log(
      `[transfer-idem] 20 并发同键 → 成功 ${fulfilled.length}/20，生成转账 ${list.length} 条，去重后 id 数 ${ids.size}，耗时 ${ms(start)}`,
    );
    expect(fulfilled.length).toBe(20);
    expect(list).toHaveLength(1);
    expect(ids.size).toBe(1);
  });

  it('转账幂等（顺序）：相同 idempotency_key 二次提交返回首次结果', async () => {
    const { me } = await register('transfer2@home.dev');
    const key = 'idem-seq-001';
    const first = await me.finance.transfers.create({
      fromAccountId: 'acct-from',
      toAccountId: 'acct-to',
      amountMinor: 3000,
      occurredAt: new Date().toISOString(),
      idempotencyKey: key,
    });
    const second = await me.finance.transfers.create({
      fromAccountId: 'acct-from',
      toAccountId: 'acct-to',
      amountMinor: 9999,
      occurredAt: new Date().toISOString(),
      idempotencyKey: key,
    });
    expect(second.id).toBe(first.id);
    const list = await me.finance.transfers.list({ limit: 100, offset: 0 });
    expect(list).toHaveLength(1);
    expect(list[0]!.amountMinor).toBe(3000);
  });
});

describe('压力 · 笔记大内容与 XSS 存储边界', () => {
  it('大体积笔记（5MB）正常存取', async () => {
    const { me } = await register('note@home.dev');
    const big = 'x'.repeat(5 * 1024 * 1024) + '【尾标记】';
    const start = t0();
    const id = await me.notes.ingest({ title: 'big-note', bodyMarkdown: big });
    const list = await me.notes.list();
    const found = list.find((n) => n.id === id);
    console.log(`[note-big] 5MB 笔记写入+读回耗时 ${ms(start)}，回读长度 ${found?.bodyMarkdown.length}`);
    expect(id).toBeTruthy();
    expect(found?.bodyMarkdown.length).toBe(big.length);
    expect(found?.bodyMarkdown.endsWith('【尾标记】')).toBe(true);
  });

  it('XSS 载荷原文落库（渲染侧白名单由前端 renderBody 负责，服务端不清洗）', async () => {
    const { me } = await register('noteXss@home.dev');
    const payload = '<script>alert(1)</script><img src=x onerror=alert(2)>';
    const id = await me.notes.ingest({
      title: 'xss-note',
      bodyMarkdown: payload,
      links: ['javascript:alert(3)', 'https://safe.example.com'],
    });
    const found = (await me.notes.list()).find((n) => n.id === id);
    console.log(`[note-xss] 存储原文含 script=${found?.bodyMarkdown.includes('<script>')}，links=${JSON.stringify(found?.links)}`);
    expect(found?.bodyMarkdown).toContain('<script>');
    expect(found?.links).toContain('javascript:alert(3)');
  });
});
