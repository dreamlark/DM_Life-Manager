import { useCallback, useEffect, useState } from 'react';
import { trpc } from './lib/trpc';
import { connectRealtime, disconnectRealtime } from './lib/realtime';
import { useAuthStore } from './store/authStore';
import { useFamilyStore } from './store/familyStore';
import { useModeStore } from './store/modeStore';
import { usePinStore, type PinCreds } from './store/pinStore';
import { AppLock } from './components/AppLock';
import LocalApp from './LocalApp';
import { AuthScreen } from './components/AuthScreen';
import { AcceptInvite } from './components/AcceptInvite';
import { FamilyBoard } from './components/FamilyBoard';
import { CalendarPage } from './components/CalendarPage';
import { FamilyFinanceBoard } from './features/finance/FamilyFinanceBoard';
import { FamilySharedHub } from './features/shared/FamilySharedHub';
import { ThemeToggle } from './components/ThemeToggle';
import { AppTopBar } from './components/AppTopBar';
import { Toaster, toast } from 'sonner';
import { useUI, applyTheme, applyFontScale } from './store/uiStore';
import { VersionBanner } from './components/VersionBanner';

type View = 'auth' | 'accept' | 'board';
type BoardTab = 'members' | 'calendar' | 'finance' | 'shared';

export default function App() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const setUser = useAuthStore((s) => s.setUser);
  const setTokens = useAuthStore((s) => s.setTokens);
  const clearAuth = useAuthStore((s) => s.clear);
  const user = useAuthStore((s) => s.user);

  const setFamilies = useFamilyStore((s) => s.setFamilies);
  const setMembers = useFamilyStore((s) => s.setMembers);
  const resetFamily = useFamilyStore((s) => s.reset);
  const currentFamilyId = useFamilyStore((s) => s.currentFamilyId);

  const hasPin = usePinStore((s) => s.hasPin);
  const expired = usePinStore((s) => s.expired);

  // 进入阶段判定（统一个人/协作模式）：
  // - 有“有效”的 PIN 库（账户已创建且未过期）→ 进看板，由 AppLock 锁屏，输 PIN 解锁。
  // - 无库（首次运行）或库已过期 → 走账户创建/登录流程（AuthScreen），账户创建完成后再引导设置 PIN；
  //   不再在首次打开时直接跳转 PIN 输入。
  const [view, setView] = useState<View>(() => {
    const ps = usePinStore.getState();
    if (ps.hasPin && !ps.expired) return 'board';
    return 'auth';
  });
  const [tab, setTab] = useState<BoardTab>('members');
  const [loading, setLoading] = useState(true);
  // 协作视图导航态（独立于 mode）：默认在个人功能壳（LocalApp），
  // 仅当用户主动点击「协作」入口时才进入家庭协作视图。
  const [familyOpen, setFamilyOpen] = useState(false);
  // PIN 解锁尝试是否已“落定”（成功置 token 或失败放行）。仅用于首屏门控：
  // 落定前不要挂载数据层（避免令牌未写入就发请求 → 误弹「请先登录」）；落定后无论成败都进入看板。
  const [unlockSettled, setUnlockSettled] = useState(false);

  // 启动：自动重连——有令牌则补取用户信息并加载家庭列表；access 缺失时尝试用 refresh 旋转恢复。
  // 已设置 PIN 时跳过服务端引导：锁屏后用 PIN 解密凭据自动登录。
  const bootstrap = useCallback(async () => {
    if (useModeStore.getState().mode === 'local') {
      setLoading(false);
      return;
    }
    if (usePinStore.getState().hasPin) {
      setLoading(false);
      return;
    }
    const { accessToken: at, refreshToken: rt } = useAuthStore.getState();
    if (!at && !rt) {
      setLoading(false);
      return;
    }
    try {
      if (!at && rt) {
        const r = await trpc.auth.refresh.mutate({ refreshToken: rt });
        useAuthStore.getState().setTokens(r.accessToken, r.refreshToken);
      }
      const me = await trpc.auth.me.query();
      setUser(me);
      const list = await trpc.families.list.query();
      setFamilies(list);
      setView('board');
    } catch {
      clearAuth();
      resetFamily();
      setView('auth');
    } finally {
      setLoading(false);
    }
  }, [setUser, setFamilies, setMembers, clearAuth, resetFamily]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // 主题应用（统一）：个人视图与家庭协作视图都由 App 顶层统一应用，
  // 单一真相来自 uiStore.theme（含 system）。跟随系统时监听系统配色变化实时切换。
  const theme = useUI((s) => s.theme);
  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  // 字号档位应用（与主题同级的单一入口）：切换时立即改写 <html data-font-scale>，
  // 由 styles.css 的 html[data-font-scale] 选择器驱动根字号，全站 rem 文本等比缩放。
  const fontScale = useUI((s) => s.fontScale);
  useEffect(() => {
    applyFontScale(fontScale);
  }, [fontScale]);

  // 实时网关：已登录且进入家庭看板时建立 WS 连接；退出登录或回到个人视图时断开
  useEffect(() => {
    if (familyOpen && accessToken && view === 'board') connectRealtime();
    else disconnectRealtime();
  }, [familyOpen, accessToken, view]);

  const onAuthed = useCallback(async () => {
    try {
      const list = await trpc.families.list.query();
      setFamilies(list);
      // 个人空间是数据容器，不作为协作看板默认家庭；默认选中首个共享家庭
      const cur = list.find((f) => f.kind === 'shared') ?? null;
      if (cur) {
        const ms = await trpc.families.members.query({ familyId: cur.id });
        setMembers(ms);
      }
      setView('board');
    } catch {
      setView('board');
    }
  }, [setFamilies, setMembers]);

  const onJoined = useCallback(async () => {
    const list = await trpc.families.list.query();
    setFamilies(list);
    const cur = list.find((f) => f.kind === 'shared') ?? null;
    if (cur) {
      const ms = await trpc.families.members.query({ familyId: cur.id });
      setMembers(ms);
    }
    setView('board');
  }, [setFamilies, setMembers]);

  // PIN 解锁成功：用解密出的邮箱/密码自动登录（个人/协作模式共用同一套凭据库）。
  // 关键修复：单后端部署后，本地模式同样走 server 的 authedProcedure，无令牌则所有个人数据操作
  // （含加任务、查任务）会被服务端以「请先登录」拒绝。此前本地模式在 onUnlock 直接 return true、
  // 不发登录请求，导致重启/PIN 重锁后内存令牌丢失、看板全挂。现统一用凭据库自动登录。
  // 若库里没有凭据或本次自动登录失败，仍放行进入个人功能——家庭协作登录在点击协作入口时按需进行，
  // 绝不因缺凭据而返回 false 导致 AppLock 误删 PIN 库。
  const onUnlock = useCallback(
    async (creds: PinCreds): Promise<boolean> => {
      // 遗留本地库：单后端切换前个人模式只写 { local: true } 占位、无真实账号凭据。
      // 此类库无法自动登录，放行会再次陷入「请先登录」且无重登路径；故清除并引导注册真实 server 账号。
      if (creds.local && !creds.email) {
        usePinStore.getState().removePin();
        setView('auth');
        return true;
      }
      if (creds.email && creds.password) {
        try {
          const r = await trpc.auth.login.mutate({ email: creds.email, password: creds.password });
          setTokens(r.accessToken, r.refreshToken);
          setUser(r.user);
          await onAuthed();
        } catch {
          // 自动登录失败（server 不可达 / 凭据失效 / 账户被删）：不再静默吞掉，
          // 提示用户，避免在「无 token」状态下静默触发「请先登录」；仍放行以保持锁屏可用。
          toast.error('自动登录失败，部分操作需重新登录');
        }
      }
      // 解锁尝试落定（成功已置 token、失败则按设计放行）。置位后首屏门控才放行挂载数据层，
      // 从而消除「locked=false 先触发 LocalApp 挂载、onUnlock 写入 token 尚未完成」的竞态。
      setUnlockSettled(true);
      return true;
    },
    [setTokens, setUser, onAuthed, setView],
  );

  // 忘记 PIN：清空凭据库；协作模式导向家庭登录视图（登录后会引导重设 PIN 落库家庭凭据），
  // 个人模式由下方 setup 副作用自动重新引导设置 PIN，无需在此处理。
  const onForgotPin = useCallback(() => {
    clearAuth();
    resetFamily();
    if (useModeStore.getState().mode === 'collab') {
      setFamilyOpen(true);
      setView('auth');
    }
  }, [clearAuth, resetFamily, setFamilyOpen, setView]);

  async function logout() {
    disconnectRealtime();
    // P1-4：服务端吊销当前 refresh 会话，避免令牌在本地被清后仍可被复用
    try {
      await trpc.auth.logout.mutate({ refreshToken: useAuthStore.getState().refreshToken ?? undefined });
    } catch {
      /* 吊销失败不阻塞登出（本地清理仍进行） */
    }
    clearAuth();
    resetFamily();
    setFamilyOpen(false);
    // 已设 PIN 则进入锁屏（输 PIN 可重新进入）；未设 PIN 回到个人功能
    if (usePinStore.getState().hasPin) usePinStore.getState().lockNow();
  }

  // 注销账户：服务端级联删除个人家庭及全部个人数据、吊销会话；客户端清除令牌、家庭态与本机凭据库，回到登录页。
  // 关键：必须 removePin——凭据库中的邮箱/密码在账户删除后已失效，否则下次启动会用失效凭据自动登录，
  // 重新陷入「请先登录」（见 onUnlock 自动登录逻辑）。
  const handleDeleteAccount = useCallback(async () => {
    try {
      await trpc.auth.deleteAccount.mutate();
      toast.success('账户已注销，全部个人数据已删除');
    } catch {
      /* 服务端删除失败时仍继续本地清理，避免卡死在已登录态 */
    } finally {
      clearAuth();
      resetFamily();
      setFamilyOpen(false);
      usePinStore.getState().removePin();
      setView('auth');
    }
  }, [clearAuth, resetFamily, setFamilyOpen, setView]);

  if (loading) {
    return (
      <div className="boot">
        <div className="spinner" />
      </div>
    );
  }

  const content = (() => {
    // 首次运行（无有效 PIN 库）或凭据过期：两种模式都先走账户创建/登录流程，
    // 绝不在首次打开时直接弹 PIN 输入。账户创建成功后再引导设置 PIN；有效期内重登仅需 PIN。
    if (view === 'auth') {
      return <AuthScreen onAuthed={onAuthed} />;
    }
    // 家庭协作视图：仅当用户主动点击「协作」入口（familyOpen）时进入。
    // 未登录或显式回到登录时展示 AuthScreen；否则展示家庭看板。
    if (familyOpen) {
      if (view === 'accept') {
        return <AcceptInvite onJoined={onJoined} onCancel={() => setFamilyOpen(false)} />;
      }
      if (!accessToken) {
        return <AuthScreen onAuthed={onAuthed} />;
      }
      return (
        <div className="app-shell">
          <VersionBanner />
          <AppTopBar
            title="家庭协作"
            brandIcon="🏡"
            brandTone="emerald"
            onBack={() => setFamilyOpen(false)}
            right={
              <>
                {user && <span className="dm-who">@{user.name}</span>}
                <ThemeToggle />
                <button className="icon-btn" title="接受邀请 / 加入家庭" onClick={() => setView('accept')} type="button">
                  ✉️
                </button>
                <button className="btn-logout" title="锁定 / 退出登录" onClick={logout} type="button">
                  <span aria-hidden="true">⏻</span> 退出
                </button>
              </>
            }
          />
          <main className="app-main">
            {currentFamilyId && (
              <div className="seg board-tabs">
                <button
                  type="button"
                  className={tab === 'members' ? 'seg-btn active' : 'seg-btn'}
                  onClick={() => setTab('members')}
                >
                  成员
                </button>
                <button
                  type="button"
                  className={tab === 'calendar' ? 'seg-btn active' : 'seg-btn'}
                  onClick={() => setTab('calendar')}
                >
                  日历
                </button>
                <button
                  type="button"
                  className={tab === 'finance' ? 'seg-btn active' : 'seg-btn'}
                  onClick={() => setTab('finance')}
                >
                  财务
                </button>
                <button
                  type="button"
                  className={tab === 'shared' ? 'seg-btn active' : 'seg-btn'}
                  onClick={() => setTab('shared')}
                >
                  共享
                </button>
              </div>
            )}
            {tab === 'members' ? (
              <FamilyBoard onLeft={() => setView('auth')} />
            ) : tab === 'finance' ? (
              <FamilyFinanceBoard />
            ) : tab === 'shared' ? (
              <FamilySharedHub />
            ) : (
              <CalendarPage />
            )}
          </main>
        </div>
      );
    }

    // 个人功能外壳（local 与 collab 模式共用）：协作模式下顶部会出现「协作」入口，
    // 点击才进入家庭协作视图；个人模式则不显示任何协作相关入口。
    //
    // 关键修复（PIN 解锁误弹「操作失败：请先登录」根因）：AppLock.unlock() 在 pinStore 中先置
    // locked=false、再返回解密凭据，于是 LocalApp 会在 onUnlock 写入 JWT 之前就挂载并发起首屏
    // 数据请求（ensureDaily 等 mutation、tasks.today / domains.list 等 query）。此时 authStore 尚无
    // token → server 401「请先登录」→ trpcLocal 全局 mutation onError 误弹 toast，而用户其实已登录成功。
    // 故首屏数据层仅在「令牌已写入」或「解锁尝试已落定（含失败放行）」后才挂载：
    //   - 落定前（locked 已 false、token 尚未写入）：展示加载态，绝不发请求 → 消除过渡期竞态。
    //   - 落定且 token 已写入（成功登录）：正常挂载数据层，请求携带有效 token。
    //   - 落定但 token 缺失（自动登录失败，按设计放行）：挂载空看板，由「自动登录失败」提示引导重登，
    //     不再卡在加载态；真实未登录场景仍由全局 onError 正确提示，安全性不受影响。
    if (!accessToken && !unlockSettled) {
      return (
        <div className="boot">
          <div className="spinner" />
        </div>
      );
    }
    return <LocalApp onOpenFamily={() => setFamilyOpen(true)} onLogout={logout} onDeleteAccount={handleDeleteAccount} />;
  })();

  return (
    <AppLock onUnlock={onUnlock} onForgotPin={onForgotPin}>
      {content}
      <Toaster theme={theme} richColors position="top-right" />
    </AppLock>
  );
}
