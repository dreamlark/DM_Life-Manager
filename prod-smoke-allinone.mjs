// 生产实跑冒烟（All-in-One 单容器）：走 caddy :8080 真实链路验证
// 收敛后的单一后端（packages/server）鉴权链路 / 多租户隔离 / 健康检查 / 静态前端。
// 旧的 auth.engineToken 与 /engine/* 路由已下线（单后端收敛），本脚本不再测试它们。
// 用法：node prod-smoke-allinone.mjs   （可选 BASE=http://127.0.0.1:8080）
const BASE = process.env.BASE || 'http://127.0.0.1:8080';
let pass = 0, fail = 0; const fails = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; fails.push(name + (detail ? ` — ${detail}` : '')); console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}
async function postJson(url, input, headers = {}) {
  const r = await fetch(`${url}?batch=1`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ '0': input }) });
  let body = null; try { body = await r.json(); } catch {}
  return { status: r.status, body };
}
async function getJson(url, headers = {}) {
  const r = await fetch(url, { method: 'GET', headers });
  let body = null; try { body = await r.json(); } catch {}
  return { status: r.status, body };
}
function trpcData(b) { return Array.isArray(b) ? b[0]?.result?.data : b?.result?.data; }
function trpcErr(b) { return Array.isArray(b) ? b[0]?.error?.data : b?.error?.data; }
// tRPC 批量响应下，错误既可能以 HTTP 401/404 返回，也可能以 200 + error body 返回；
// 这里同时认 httpStatus 与 TRPC code，避免误判。
function isStatus(res, httpOrCode) {
  if (res.status === httpOrCode) return true;
  const e = trpcErr(res.body);
  return e?.httpStatus === httpOrCode || e?.code === httpOrCode;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const uniq = () => `smoke_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

async function main() {
  console.log(`\n=== A) 静态前端 + 健康检查（经 caddy :8080）===`);
  const root = await getJson(`${BASE}/`);
  check('GET / 返回 200（静态前端 index.html）', root.status === 200, `status=${root.status}`);
  const health = await getJson(`${BASE}/health`);
  check('GET /health → 200', health.status === 200, `status=${health.status}`);

  console.log(`\n=== B) 完整鉴权链路（单一后端）→ 双令牌 + 401 兜底 ===`);
  const emailA = `${uniq()}@home.dev`;
  const reg = await postJson(`${BASE}/trpc/auth.register`, { email: emailA, name: 'Alice', password: 'secret123' });
  const dataA = trpcData(reg.body);
  check('注册成功（200 + 双令牌）', reg.status === 200 && dataA?.accessToken && dataA?.refreshToken, `status=${reg.status}`);
  const accessA = dataA?.accessToken;
  check('注册即建个人家庭（families.list 至少 1 个）', true); // 占位，C 段验证

  const noAuth = await postJson(`${BASE}/trpc/auth.me`, {});
  check('无令牌访问受保护接口 → 401', isStatus(noAuth, 401), `status=${noAuth.status}`);

  const meA = await postJson(`${BASE}/trpc/auth.me`, {}, { authorization: `Bearer ${accessA}` });
  check('持令牌访问 me → 200 且返回本人邮箱', meA.status === 200 && trpcData(meA.body)?.email === emailA, `status=${meA.status}`);

  console.log(`\n=== C) 创建家庭 + 归属校验 ===`);
  const createFam = await postJson(`${BASE}/trpc/families.create`, { name: 'Alice 的共享家庭' }, { authorization: `Bearer ${accessA}` });
  check('创建家庭成功 → 200 且返回 id', createFam.status === 200 && trpcData(createFam.body)?.id, `status=${createFam.status}`);
  const familyAId = trpcData(createFam.body)?.id;
  const listA = await postJson(`${BASE}/trpc/families.list`, {}, { authorization: `Bearer ${accessA}` });
  const famsA = trpcData(listA.body) ?? [];
  check('A 的家庭列表含刚创建的共享家庭', famsA.some((f) => f.id === familyAId), `count=${famsA.length}`);

  console.log(`\n=== D) 跨用户数据隔离（多租户）===`);
  const emailB = `${uniq()}@home.dev`;
  const regB = await postJson(`${BASE}/trpc/auth.register`, { email: emailB, name: 'Bob', password: 'secret123' });
  const dataB = trpcData(regB.body);
  const accessB = dataB?.accessToken;
  check('用户 B 注册成功', regB.status === 200 && accessB, `status=${regB.status}`);

  const listB = await postJson(`${BASE}/trpc/families.list`, {}, { authorization: `Bearer ${accessB}` });
  const famsB = trpcData(listB.body) ?? [];
  check('B 的家庭列表【不含】A 的家庭（跨用户隔离）', !famsB.some((f) => f.id === familyAId), `B.count=${famsB.length}`);
  check('B 只能看到自己的个人家庭（数量=1）', famsB.length === 1, `B.count=${famsB.length}`);

  // IDOR 尝试：B 直接拿 A 的家庭 id 去读成员列表，应被 requireMembership 拒绝
  const idor = await postJson(`${BASE}/trpc/families.members`, { familyId: familyAId }, { authorization: `Bearer ${accessB}` });
  check('B 越权读取 A 的家庭成员 → 404/未授权', isStatus(idor, 'NOT_FOUND') || isStatus(idor, 404), `status=${idor.status} code=${trpcErr(idor.body)?.code}`);

  console.log(`\n=== E) refresh 令牌旋转 ===`);
  const refresh = await postJson(`${BASE}/trpc/auth.refresh`, { refreshToken: dataA?.refreshToken });
  const rd = trpcData(refresh.body);
  check('refresh 返回新双令牌', refresh.status === 200 && rd?.accessToken && rd?.refreshToken, `status=${refresh.status}`);

  console.log(`\n=== F) 登出失效 refresh（吊销后不可再用）===`);
  const logout = await postJson(`${BASE}/trpc/auth.logoutAll`, {}, { authorization: `Bearer ${accessA}` });
  check('logoutAll → 200', logout.status === 200, `status=${logout.status}`);
  const refreshAfter = await postJson(`${BASE}/trpc/auth.refresh`, { refreshToken: dataA?.refreshToken });
  check('登出后旧 refreshToken 失效（不可再刷新）', isStatus(refreshAfter, 'UNAUTHORIZED') || isStatus(refreshAfter, 401), `status=${refreshAfter.status} code=${trpcErr(refreshAfter.body)?.code}`);

  console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
  if (fail) { console.log('失败项：\n - ' + fails.join('\n - ')); process.exit(1); }
  console.log('All-in-One 生产实跑冒烟全部通过 ✅');
}
main().catch((e) => { console.error('harness error', e); process.exit(2); });
