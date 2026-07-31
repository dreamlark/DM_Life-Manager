// M2.3 端到端冒烟：真实浏览器驱动 UI，跑通协作闭环。
// 用系统 Chrome（managed workspace 里的 playwright 库）+ 绕过沙箱代理。
import { createRequire } from 'node:module';
const require = createRequire('C:/Users/39488/.workbuddy/binaries/node/workspace/node_modules/');
const { chromium } = require('playwright');

const BASE = process.env.WEB_URL || 'http://127.0.0.1:5173';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const stamp = Date.now();
const aliceEmail = `alice_${stamp}@home.dev`;
const bobEmail = `bob_${stamp}@home.dev`;

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}
async function section(title) {
  console.log(`\n── ${title} ──`);
}

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-proxy-server', '--no-sandbox'],
  proxy: { server: 'direct://' },
});

// 收集页面运行时错误（捕获白屏）
const pageErrors = [];
function watch(page) {
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push('console.error: ' + m.text());
  });
}

const ctxA = await browser.newContext();
const ctxB = await browser.newContext();
const pageA = await ctxA.newPage();
const pageB = await ctxB.newPage();
watch(pageA);
watch(pageB);

let inviteToken = '';

try {
  // ===== 1) alice 注册 → 自动创建个人家庭 → 看板 =====
  await section('alice 注册并自动获得家庭看板');
  await pageA.goto(BASE, { waitUntil: 'domcontentloaded' });
  await pageA.getByRole('button', { name: '注册' }).click();
  await pageA.locator('input[placeholder="你的名字"]').fill('alice');
  await pageA.locator('input[placeholder="you@home.dev"]').fill(aliceEmail);
  await pageA.locator('input[placeholder="至少 6 位"]').fill('secret123');
  await pageA.getByRole('button', { name: '创建账号' }).click();

  await pageA.waitForSelector('.board', { timeout: 15000 });
  const aliceFamily = await pageA.locator('.board-title h2').innerText();
  check('alice 注册后自动进入看板', true, aliceFamily);
  check('看板显示自动创建的家庭', aliceFamily.includes('alice'), aliceFamily);
  const aliceRole = await pageA.locator('.my-role').innerText();
  check('alice 角色为所有者', aliceRole.includes('所有者'), aliceRole);

  // ===== 2) alice 邀请成员（role=member）→ 取得令牌 =====
  await section('alice 生成邀请令牌');
  await pageA.getByRole('button', { name: '＋ 邀请成员' }).click();
  await pageA.getByRole('button', { name: '生成邀请令牌' }).click();
  await pageA.waitForSelector('.token-box', { timeout: 10000 });
  inviteToken = (await pageA.locator('.token-box').innerText()).trim();
  check('成功生成邀请令牌', inviteToken.length > 8, `len=${inviteToken.length}`);
  await pageA.getByRole('button', { name: '完成' }).click();

  // ===== 3) bob 注册 → 接受邀请加入 alice 的家庭（独立浏览器上下文）=====
  await section('bob 注册并接受邀请');
  await pageB.goto(BASE, { waitUntil: 'domcontentloaded' });
  await pageB.getByRole('button', { name: '注册' }).click();
  await pageB.locator('input[placeholder="你的名字"]').fill('bob');
  await pageB.locator('input[placeholder="you@home.dev"]').fill(bobEmail);
  await pageB.locator('input[placeholder="至少 6 位"]').fill('secret123');
  await pageB.getByRole('button', { name: '创建账号' }).click();
  await pageB.waitForSelector('.board', { timeout: 15000 });

  await pageB.locator('button[title="接受邀请"]').click();
  await pageB.locator('input[placeholder="家人分享给你的邀请码"]').fill(inviteToken);
  await pageB.getByRole('button', { name: '加入家庭' }).click();
  await pageB.waitForSelector('.board', { timeout: 15000 });

  // bob 当前家庭可能默认是自己的；切到 alice 的家庭以验证协作视图
  const switched = await pageB.locator('select.family-switch').count();
  if (switched > 0) {
    const labels = await pageB
      .locator('select.family-switch')
      .evaluate((sel) => Array.from(sel.options).map((o) => o.label));
    const aliceLabel = labels.find((l) => l.includes('alice'));
    if (aliceLabel) {
      await pageB.locator('select.family-switch').selectOption({ label: aliceLabel });
    }
    await pageB.locator('.member-card', { hasText: 'alice' }).first().waitFor({ timeout: 8000 });
  }
  const boardTextB = await pageB.locator('.board').innerText();
  check('bob 看板可见 alice（被邀请加入）', boardTextB.includes('alice'), '');
  check('bob 看板显示自己(你)', boardTextB.includes('你'), '');
  // RBAC：bob 是 member，不应对 alice 卡片看到管理操作
  const manageInBob = await pageB.locator('.member-card:has-text("alice") .role-select').count();
  check('成员 bob 看不到「改角色」管理控件（RBAC 前端收敛）', manageInBob === 0, `role-select=${manageInBob}`);

  // ===== 4) alice 看板实时推送 → bob 自动出现（无需 reload）→ owner 管理权限 =====
  await section('alice 看板：WebSocket 实时推送让 bob 自动出现（无手动 reload）');
  // 关键验证：bob 在独立上下文接受邀请后，alice 应通过 WS 推送即时看到 bob，无需 pageA.reload()
  await pageA.locator('.member-card', { hasText: 'bob' }).first().waitFor({ timeout: 10000 });
  const boardTextA = await pageA.locator('.board').innerText();
  check('alice 看板（实时推送）出现成员 bob，无需 reload', boardTextA.includes('bob'), '');

  // 在线状态：bob 接受邀请后其 WS 连接建立，alice 看板应标记 bob 在线（presence 推送）
  let bobOnline = 0;
  try {
    await pageA.locator('.member-card.online', { hasText: 'bob' }).first().waitFor({ timeout: 8000 });
    bobOnline = 1;
  } catch {
    bobOnline = 0;
  }
  check('alice 看板显示 bob 在线（presence 推送）', bobOnline > 0, `online=${bobOnline}`);

  const bobCard = pageA.locator('.member-card', { hasText: 'bob' }).first();
  const hasRoleSelect = await bobCard.locator('.role-select').count();
  const hasTransfer = await bobCard.locator('button:has-text("转让所有者")').count();
  check('owner 对 bob 卡片可见「改角色」', hasRoleSelect > 0, `role-select=${hasRoleSelect}`);
  check('owner 对 bob 卡片可见「转让所有者」', hasTransfer > 0, `transfer=${hasTransfer}`);

  // ===== 5) owner 修改 bob 角色为管理员（RBAC 写路径）=====
  await section('alice 将 bob 提升为管理员（写路径验证）');
  await bobCard.locator('.role-select').selectOption({ label: '管理员' });
  await pageA.waitForFunction(
    () => document.querySelector('.board-feedback')?.textContent?.includes('管理员') || false,
    { timeout: 8000 },
  ).catch(() => {});
  const bobBadge = await bobCard.locator('.role-badge').innerText();
  check('bob 角色已更新为管理员', bobBadge.includes('管理员'), bobBadge);

  // ===== 6) 主题切换（浅/深/系统）=====
  await section('主题切换');
  const beforeTheme = await pageA.evaluate(() => document.documentElement.className);
  let themeChanged = false;
  for (let i = 0; i < 3; i++) {
    await pageA.locator('button:has(.theme-icon)').click();
    await pageA.waitForTimeout(250);
    const now = await pageA.evaluate(() => document.documentElement.className);
    if (now !== beforeTheme) {
      themeChanged = true;
      break;
    }
  }
  check('点击主题切换后 documentElement 类变化', themeChanged, `${beforeTheme} -> changed`);

  // ===== 7) 共享任务实时协作：alice 建任务 → bob 跨上下文实时认领 =====
  await section('共享任务：alice 建任务，bob 实时认领（WebSocket 推送）');
  // alice 切到「任务」标签
  await pageA.locator('.seg-btn', { hasText: '任务' }).click();
  await pageA.waitForSelector('.task-cols', { timeout: 10000 });
  // alice 新建任务
  await pageA.getByRole('button', { name: '＋ 新建任务' }).click();
  await pageA.waitForSelector('.modal input[placeholder="例如：周末大扫除"]', { timeout: 8000 });
  await pageA.locator('.modal input[placeholder="例如：周末大扫除"]').fill('周末大扫除');
  await pageA.getByRole('button', { name: '创建任务' }).click();
  const aliceCard = pageA.locator('.task-card', { hasText: '周末大扫除' }).first();
  await aliceCard.waitFor({ timeout: 10000 });
  check('alice 看板出现自建任务「周末大扫除」', true, '周末大扫除');

  // bob 切到「任务」标签，应通过实时推送（或首次加载）看到该任务
  await pageB.locator('.seg-btn', { hasText: '任务' }).click();
  await pageB.waitForSelector('.task-cols', { timeout: 10000 });
  const bobTaskCard = pageB.locator('.task-card', { hasText: '周末大扫除' }).first();
  await bobTaskCard.waitFor({ timeout: 10000 });
  check('bob 看板实时出现 alice 新建的任务', true, '周末大扫除');

  // bob 认领（member 具备 createTask）
  await bobTaskCard.getByRole('button', { name: '认领' }).click();
  // alice 一侧应通过 WS 实时看到负责人变为 bob（无需 reload）
  const aliceAssignee = pageA.locator('.task-card', { hasText: '周末大扫除' }).first().locator('.assignee');
  await aliceAssignee.filter({ hasText: 'bob' }).first().waitFor({ timeout: 10000 });
  const assigneeText = await aliceAssignee.first().innerText();
  check('alice 实时看到任务被 bob 认领（负责人=bob）', assigneeText.includes('bob'), assigneeText);

  // ===== 8) 共享日历实时协作：alice 建事件 → bob 跨上下文实时看到 =====
  await section('共享日历：alice 建事件，bob 通过 WebSocket 实时看到');
  // bob 先切到「日历」标签，确保实时订阅已建立（才能收到推送）
  await pageB.locator('.seg-btn', { hasText: '日历' }).click();
  await pageB.waitForSelector('.cal-grid', { timeout: 10000 });

  // alice 也切到「日历」标签
  await pageA.locator('.seg-btn', { hasText: '日历' }).click();
  await pageA.waitForSelector('.cal-grid', { timeout: 10000 });

  // alice 新建日历事件
  await pageA.getByRole('button', { name: '＋ 新建事件' }).click();
  await pageA
    .locator('.modal input[placeholder="例如：家庭聚餐"]')
    .waitFor({ timeout: 8000 });
  await pageA.locator('.modal input[placeholder="例如：家庭聚餐"]').fill('家庭聚餐');
  await pageA.getByRole('button', { name: '创建事件' }).click();

  // alice 一侧立即看到自建事件 chip（今天 9:00，落在当前月视图）
  const aliceChip = pageA.locator('.cal-chip', { hasText: '家庭聚餐' }).first();
  await aliceChip.waitFor({ timeout: 10000 });
  check('alice 看板出现自建日历事件「家庭聚餐」', true, '家庭聚餐');

  // bob 一侧应通过 WS 实时推送看到该事件（无需 reload）
  const bobChip = pageB.locator('.cal-chip', { hasText: '家庭聚餐' }).first();
  await bobChip.waitFor({ timeout: 10000 });
  const bobCalText = await pageB.locator('.cal-grid').innerText();
  check('bob 看板实时出现 alice 新建的日历事件', bobCalText.includes('家庭聚餐'), '家庭聚餐');

  // ===== 运行期错误检查 =====
  await section('运行期错误');
  // 忽略无害的资源 404（如 favicon），只关心真正的 JS 运行时异常
  const realErrors = pageErrors.filter((e) => !/Failed to load resource/i.test(e));
  check('无页面/控制台运行时错误', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
} catch (e) {
  check('e2e 执行未抛异常', false, String(e && e.stack ? e.stack : e));
  if (pageErrors.length) console.log('\n捕获到的页面错误：\n' + pageErrors.join('\n'));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n==== 结果：${results.length - failed.length}/${results.length} 通过 ====`);
if (failed.length) {
  console.log('失败项：');
  for (const f of failed) console.log(`  - ${f.name} ${f.detail ? '(' + f.detail + ')' : ''}`);
  process.exit(1);
}
console.log('🎉 M2.3 端到端冒烟全部通过');
process.exit(0);
