// 预算面板：展示个人预算（引擎新增实体）与实际支出对比，并作为「家庭共享」的可选项之一。
// 数据来自个人模式 engine（trpcLocal.finance.budgets.*）。
import { useState } from 'react';
import { toast } from 'sonner';
import { PiggyBank, Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import { trpc } from '../../lib/trpcLocal';

function fmt(n: number): string {
  return `¥${n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;
}

function progressTone(p: number): string {
  if (p < 0.8) return 'bg-emerald-400/80';
  if (p < 1) return 'bg-amber-400/80';
  return 'bg-red-400/80';
}

export function BudgetPanel() {
  const listQ = trpc.finance.budgets.list.useQuery(undefined);
  const utils = trpc.useUtils();
  const createM = trpc.finance.budgets.create.useMutation(undefined);
  const updateM = trpc.finance.budgets.update.useMutation(undefined);
  const deleteM = trpc.finance.budgets.delete.useMutation(undefined);

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'overall' | 'category'>('overall');
  const [category, setCategory] = useState('');
  const [limit, setLimit] = useState('');
  const [busy, setBusy] = useState(false);

  const budgets = listQ.data ?? [];

  function resetForm() {
    setEditingId(null);
    setName('');
    setScope('overall');
    setCategory('');
    setLimit('');
  }

  function startCreate() {
    resetForm();
    setOpen(true);
  }
  function startEdit(b: any) {
    setEditingId(b.id);
    setName(b.name ?? '');
    setScope(b.scope ?? 'overall');
    setCategory(b.category ?? '');
    setLimit(String(b.monthlyLimit ?? ''));
    setOpen(true);
  }

  async function save() {
    const monthlyLimit = Number(limit);
    if (!name.trim()) {
      toast.error('请填写预算名称');
      return;
    }
    if (!(monthlyLimit > 0)) {
      toast.error('月度限额必须大于 0');
      return;
    }
    setBusy(true);
    try {
      if (editingId) {
        await updateM.mutateAsync({
          id: editingId,
          name: name.trim(),
          scope,
          category: scope === 'category' ? category.trim() || null : null,
          monthlyLimit,
        });
        toast.success('预算已更新');
      } else {
        await createM.mutateAsync({
          name: name.trim(),
          scope,
          category: scope === 'category' ? category.trim() || null : null,
          monthlyLimit,
        });
        toast.success('预算已创建');
      }
      setOpen(false);
      resetForm();
      await utils.finance.budgets.list.invalidate();
    } catch {
      /* 错误已由全局 onError 提示 */
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm('删除该预算？')) return;
    await deleteM.mutateAsync({ id });
    await utils.finance.budgets.list.invalidate();
    toast.success('预算已删除');
  }

  return (
    <section className="rounded-xl border border-bg-border bg-bg-panel p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-200">
        <PiggyBank size={16} className="text-accent" /> 预算
        <button
          className="ml-auto flex items-center gap-1 rounded-md border border-bg-border bg-bg-raised px-2 py-1 text-xs text-gray-200 hover:border-accent/50"
          type="button"
          onClick={startCreate}
        >
          <Plus size={12} /> 新建预算
        </button>
      </h3>

      {budgets.length === 0 ? (
        <p className="text-xs text-gray-600">还没有预算。新建一个来追踪每月开销。</p>
      ) : (
        <div className="space-y-3">
          {budgets.map((b: any) => {
            const pct = Math.round((b.progress ?? 0) * 100);
            const over = (b.progress ?? 0) > 1;
            return (
              <div key={b.id} className="rounded-lg border border-bg-border bg-bg-base p-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-100">{b.name}</span>
                  <span className="rounded bg-bg-raised px-1.5 py-0.5 text-[10px] text-gray-400">
                    {b.scope === 'category' ? `类别·${b.category ?? '—'}` : '全局'}
                  </span>
                  <span className="ml-auto flex items-center gap-1">
                    <button className="rounded p-1 text-gray-500 hover:text-accent" type="button" onClick={() => startEdit(b)} title="编辑">
                      <Pencil size={13} />
                    </button>
                    <button className="rounded p-1 text-gray-500 hover:text-red-400" type="button" onClick={() => remove(b.id)} title="删除">
                      <Trash2 size={13} />
                    </button>
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="text-gray-400">
                    已花费 <span className={over ? 'text-red-300' : 'text-gray-100'}>{fmt(b.spent ?? 0)}</span> / 限额{' '}
                    {fmt(b.monthlyLimit ?? 0)}
                  </span>
                  <span className={over ? 'text-red-300' : 'text-gray-300'}>{pct}%</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-bg-raised">
                  <div
                    className={`h-full rounded-full ${progressTone(b.progress ?? 0)}`}
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </div>
                {b.note ? <div className="mt-1.5 text-[11px] text-gray-500">{b.note}</div> : null}
              </div>
            );
          })}
        </div>
      )}

      {open && (
        <div className="mt-3 rounded-lg border border-accent/30 bg-bg-base p-3">
          <div className="mb-2 text-xs font-semibold text-gray-200">{editingId ? '编辑预算' : '新建预算'}</div>
          <label className="mb-2 block text-[11px] text-gray-400">
            名称
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-md border border-bg-border bg-bg-panel px-2 py-1 text-sm text-gray-100 outline-none focus:border-accent/60"
              placeholder="如 月度餐饮"
            />
          </label>
          <div className="mb-2 flex gap-2">
            <label className="flex-1 text-[11px] text-gray-400">
              范围
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as 'overall' | 'category')}
                className="mt-1 w-full rounded-md border border-bg-border bg-bg-panel px-2 py-1 text-sm text-gray-100"
              >
                <option value="overall">全局预算</option>
                <option value="category">指定类别</option>
              </select>
            </label>
            {scope === 'category' && (
              <label className="flex-1 text-[11px] text-gray-400">
                类别
                <input
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="mt-1 w-full rounded-md border border-bg-border bg-bg-panel px-2 py-1 text-sm text-gray-100 outline-none focus:border-accent/60"
                  placeholder="如 餐饮"
                />
              </label>
            )}
          </div>
          <label className="mb-2 block text-[11px] text-gray-400">
            月度限额（元）
            <input
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              type="number"
              min="0"
              step="0.01"
              className="mt-1 w-full rounded-md border border-bg-border bg-bg-panel px-2 py-1 text-sm text-gray-100 outline-none focus:border-accent/60"
              placeholder="如 2000"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button
              className="flex items-center gap-1 rounded-md border border-bg-border bg-bg-raised px-2 py-1 text-xs text-gray-300 hover:border-accent/50"
              type="button"
              onClick={() => {
                setOpen(false);
                resetForm();
              }}
            >
              <X size={12} /> 取消
            </button>
            <button
              className="flex items-center gap-1 rounded-md border border-accent/50 bg-accent/15 px-2 py-1 text-xs text-accent hover:bg-accent/25"
              type="button"
              disabled={busy}
              onClick={() => void save()}
            >
              <Check size={12} /> {busy ? '保存中…' : '保存'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
