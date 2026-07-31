import { useEffect, useRef, useState } from 'react';
import {
  Download,
  Upload,
  FilePlus2,
  Save,
  Network,
  Trash2,
  Pencil,
  PanelLeft,
  Plus,
  ChevronLeft,
  X,
  Share2,
} from 'lucide-react';
import { toast } from 'sonner';
import MindElixir, { type MindElixirData, type MindElixirInstance } from 'mind-elixir';
import { zh_CN } from 'mind-elixir/i18n';
import 'mind-elixir/style.css';
import { useUI } from '../../store/uiStore';
import {
  loadStore,
  createMap,
  updateMap,
  deleteMap,
  setActiveMap,
  type MindMapStore,
} from './mindMapStorage';
import { MindMapShareConfig } from './MindMapShareConfig';
import { SHARE_BTN } from '../shared/shareButton';
import { useCollaborative } from '../../store/modeStore';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export function MindMapPage() {
  const theme = useUI((s) => s.theme);
  const containerRef = useRef<HTMLDivElement>(null);
  const mindRef = useRef<MindElixirInstance | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [store, setStore] = useState<MindMapStore>(() => loadStore());
  const storeRef = useRef(store);
  const [savedAt, setSavedAt] = useState<string>('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const collaborative = useCollaborative();

  // 保持 ref 与 state 同步，避免 operation 监听器的闭包过期
  useEffect(() => {
    storeRef.current = store;
  }, [store]);

  const activeMap = store.maps.find((m) => m.id === store.activeId) ?? store.maps[0]!;

  // 初始化（StrictMode 下 mount→unmount→mount，靠 destroy 清理避免重复实例）
  useEffect(() => {
    if (!containerRef.current) return;
    const mind = new MindElixir({
      el: containerRef.current,
      direction: MindElixir.SIDE,
      theme: theme === 'dark' ? MindElixir.DARK_THEME : MindElixir.THEME,
      editable: true,
      contextMenu: { locale: zh_CN },
      toolBar: true,
      allowUndo: true,
    });

    const initial = storeRef.current.maps.find((m) => m.id === storeRef.current.activeId);
    mind.init(initial?.data ?? storeRef.current.maps[0]!.data);

    // 任意编辑操作 → 防抖持久化到当前脑图
    mind.bus.addListener('operation', () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        try {
          const data = mind.getData();
          const next = updateMap(storeRef.current, storeRef.current.activeId, { data });
          storeRef.current = next;
          setStore(next);
          setSavedAt(new Date().toLocaleTimeString());
        } catch {
          toast.error('保存失败：本地存储不可用');
        }
      }, 600);
    });

    mindRef.current = mind;
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      mind.destroy();
      mindRef.current = null;
    };
    // 仅在挂载时初始化一次；主题切换由下方独立 effect 处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 主题切换：实时换肤，不重建实例
  useEffect(() => {
    mindRef.current?.changeTheme(theme === 'dark' ? MindElixir.DARK_THEME : MindElixir.THEME);
  }, [theme]);

  const flushCurrent = (mind: MindElixirInstance) => {
    try {
      const data = mind.getData();
      const next = updateMap(storeRef.current, storeRef.current.activeId, { data });
      storeRef.current = next;
      setStore(next);
    } catch {
      // ignore
    }
  };

  const handleSwitch = (id: string) => {
    if (id === storeRef.current.activeId) return;
    const mind = mindRef.current;
    if (!mind) return;
    flushCurrent(mind);
    const next = setActiveMap(storeRef.current, id);
    storeRef.current = next;
    setStore(next);
    const target = next.maps.find((m) => m.id === id)!;
    mind.refresh(target.data);
    setSavedAt('');
  };

  const handleNew = () => {
    if (!window.confirm('新建会保存当前脑图并切换到新脑图，继续？')) return;
    const mind = mindRef.current;
    if (!mind) return;
    flushCurrent(mind);
    const name = `新脑图 ${storeRef.current.maps.length + 1}`;
    const next = createMap(storeRef.current, name);
    storeRef.current = next;
    setStore(next);
    const target = next.maps.find((m) => m.id === next.activeId)!;
    mind.refresh(target.data);
    toast.success('已创建新脑图');
  };

  const handleDelete = (id: string) => {
    const map = storeRef.current.maps.find((m) => m.id === id);
    if (!map) return;
    if (!window.confirm(`删除脑图「${map.name}」？此操作不可恢复。`)) return;
    const mind = mindRef.current;
    const next = deleteMap(storeRef.current, id);
    storeRef.current = next;
    setStore(next);
    if (mind) {
      const target = next.maps.find((m) => m.id === next.activeId)!;
      mind.refresh(target.data);
    }
    toast.success('已删除脑图');
  };

  const startRename = (id: string, name: string) => {
    setRenamingId(id);
    setRenameValue(name);
  };

  const commitRename = (id: string) => {
    const name = renameValue.trim();
    if (name) {
      const next = updateMap(storeRef.current, id, { name });
      storeRef.current = next;
      setStore(next);
    }
    setRenamingId(null);
    setRenameValue('');
  };

  const handleSave = () => {
    const mind = mindRef.current;
    if (!mind) return;
    flushCurrent(mind);
    setSavedAt(new Date().toLocaleTimeString());
    toast.success('已保存到本地');
  };

  const handleExportPng = async () => {
    const blob = await mindRef.current?.exportPng();
    if (blob) {
      downloadBlob(blob, `mindmap-${Date.now()}.png`);
      toast.success('已导出 PNG');
    }
  };

  const handleExportSvg = () => {
    const blob = mindRef.current?.exportSvg();
    if (blob) {
      downloadBlob(blob, `mindmap-${Date.now()}.svg`);
      toast.success('已导出 SVG');
    }
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result)) as MindElixirData;
        const mind = mindRef.current;
        if (!mind) return;
        flushCurrent(mind);
        const next = updateMap(storeRef.current, storeRef.current.activeId, { data });
        storeRef.current = next;
        setStore(next);
        mind.refresh(data);
        toast.success('已导入并覆盖当前脑图');
      } catch {
        toast.error('导入失败：文件不是有效的脑图 JSON');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const toolBtn =
    'flex items-center gap-1.5 rounded-md border border-bg-border bg-bg-raised px-2.5 py-1.5 text-xs text-gray-200 transition hover:border-accent/50';
  const sidebarItem =
    'group flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs transition hover:bg-bg-raised';
  const sidebarItemActive = 'bg-bg-raised ring-1 ring-accent/30';

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-baseline gap-2">
        <h2 className="text-base font-semibold text-gray-100">思维导图 · 脑图</h2>
        <span className="text-xs text-gray-500">记录更大的愿景与框架架构</span>
        <div className="ml-auto flex items-center gap-2">
          {collaborative && (
            <button
              className={`${SHARE_BTN}`}
              onClick={() => setShareOpen(true)}
              title="共享到家庭"
            >
              <Share2 size={13} /> 共享到家庭
            </button>
          )}
          <span className="text-[11px] text-gray-500">
            {savedAt ? `已保存 ${savedAt}` : '编辑即自动保存'}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button className={toolBtn} onClick={handleSave}>
          <Save size={13} /> 保存
        </button>
        <button className={toolBtn} onClick={handleNew}>
          <FilePlus2 size={13} /> 新建
        </button>
        <button className={toolBtn} onClick={handleExportPng}>
          <Download size={13} /> 导出 PNG
        </button>
        <button className={toolBtn} onClick={handleExportSvg}>
          <Download size={13} /> 导出 SVG
        </button>
        <label className={toolBtn}>
          <Upload size={13} /> 导入
          <input type="file" accept="application/json,.json" className="hidden" onChange={handleImport} />
        </label>
        <button
          className={`${toolBtn} ${sidebarOpen ? 'border-accent/50 text-accent' : ''}`}
          onClick={() => setSidebarOpen((v) => !v)}
          aria-expanded={sidebarOpen}
        >
          <PanelLeft size={13} /> {sidebarOpen ? '收起列表' : '脑图列表'}
        </button>
        <span className="flex items-center gap-1 text-[11px] text-gray-500">
          <Network size={11} /> 双击节点编辑 · 右键菜单 · Tab 加子节点
        </span>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        {/* 侧边栏：可伸缩，展开时推挤画布、不遮挡主内容区域 */}
        <aside
          className={`overflow-hidden transition-[width] duration-300 ease-out ${
            sidebarOpen ? 'w-56' : 'w-0'
          }`}
        >
          <div className="flex h-full w-56 flex-col rounded-xl border border-bg-border bg-bg-panel">
            <div className="flex items-center justify-between border-b border-bg-border px-3 py-2">
              <span className="text-xs font-medium text-gray-200">我的脑图</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="rounded p-1 text-gray-400 hover:bg-bg-raised hover:text-gray-200"
                  onClick={handleNew}
                  title="新建脑图"
                >
                  <Plus size={13} />
                </button>
                <button
                  type="button"
                  className="rounded p-1 text-gray-400 hover:bg-bg-raised hover:text-gray-200"
                  onClick={() => setSidebarOpen(false)}
                  title="收起侧边栏"
                >
                  <ChevronLeft size={13} />
                </button>
              </div>
            </div>
            <ul className="flex-1 space-y-0.5 overflow-y-auto p-2">
              {store.maps.map((m) => {
                const active = m.id === activeMap.id;
                return (
                  <li
                    key={m.id}
                    className={`${sidebarItem} ${active ? sidebarItemActive : ''}`}
                    onClick={() => handleSwitch(m.id)}
                  >
                    {renamingId === m.id ? (
                      <input
                        autoFocus
                        className="w-full rounded bg-bg-base px-1.5 py-1 text-xs text-gray-100 outline-none ring-accent/30 focus:ring-2"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => commitRename(m.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename(m.id);
                          if (e.key === 'Escape') {
                            setRenamingId(null);
                            setRenameValue('');
                          }
                          e.stopPropagation();
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <>
                        <span className="flex-1 truncate text-gray-200">{m.name}</span>
                        <span className="text-[10px] text-gray-500">{formatTime(m.updatedAt)}</span>
                        <button
                          type="button"
                          className="rounded p-1 text-gray-400 opacity-0 transition hover:bg-bg-base hover:text-gray-200 group-hover:opacity-100"
                          onClick={(e) => {
                            e.stopPropagation();
                            startRename(m.id, m.name);
                          }}
                          title="重命名"
                        >
                          <Pencil size={11} />
                        </button>
                        {store.maps.length > 1 && (
                          <button
                            type="button"
                            className="rounded p-1 text-gray-400 opacity-0 transition hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(m.id);
                            }}
                            title="删除"
                          >
                            <Trash2 size={11} />
                          </button>
                        )}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>

        {/* MindElixir 挂载容器 */}
        <div
          ref={containerRef}
          className="min-h-0 flex-1 overflow-hidden rounded-xl border border-bg-border bg-bg-panel"
        />
      </div>

      {/* 共享到家庭配置面板 */}
      {collaborative && <MindMapShareConfig open={shareOpen} onClose={() => setShareOpen(false)} />}
    </div>
  );
}
