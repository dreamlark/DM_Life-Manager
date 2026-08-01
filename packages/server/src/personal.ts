// 个人域 tRPC 路由（从 engine 整体迁移到 server；全部按 personal family 隔离）。
// 每个写操作在成功后 publish 个人域实时事件，前端无需整页重拉即可精准刷新对应看板。
// 过程/字段命名与 engine 的 appRouter 逐字对齐，前端无需改动。
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, authedProcedure } from './trpc';
import { store } from './store';
import { publishEvent, type PersonalEventKind } from './realtime/eventBus';
import {
  createTaskSchema,
  completeTaskSchema,
  uncompleteTaskSchema,
  updateTaskSchema,
  setQuadrantSchema,
  scheduleTaskSchema,
  setMitSchema,
  ensureDailySchema,
  deleteTaskSchema,
  createProjectSchema,
  ingestNoteSchema,
  updateNoteSchema,
  deleteNoteSchema,
  createDebtSchema,
  updateDebtSchema,
  closeDebtSchema,
  reopenDebtSchema,
  deleteDebtSchema,
  recordIncomeSchema,
  updateIncomeSchema,
  deleteIncomeSchema,
  recordTransactionSchema,
  updateTransactionSchema,
  deleteTransactionSchema,
  recordAssetSchema,
  updateAssetSchema,
  deleteAssetSchema,
  createBudgetSchema,
  updateBudgetSchema,
  deleteBudgetSchema,
  exportReportInputSchema,
  createReminderSchema,
  completeReminderSchema,
  rewindReminderSchema,
  snoozeReminderSchema,
  updateReminderSchema,
  deleteReminderSchema,
  recordFocusSessionSchema,
  flowSummaryQuerySchema,
  captureInterestSchema,
  updateInterestSchema,
  setInterestStatusSchema,
  validateInterestSchema,
  convertInterestSchema,
  interestReviewQuerySchema,
  transferCreateSchema,
  transferListSchema,
  transferGetSchema,
  transferReverseSchema,
} from '@dm-life/shared';

/** 写成功后广播个人域事件（entityId 为受影响实体 id，便于前端精准刷新） */
function emit(ctx: { userId: string }, kind: PersonalEventKind, familyId: string, entityId?: string) {
  publishEvent({ kind, familyId, actorId: ctx.userId, entityId });
}

export const personalRouters = {
  tasks: router({
    today: authedProcedure
      .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).optional())
      .query(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        return store.listToday(familyId, input?.date);
      }),
    ensureDaily: authedProcedure
      .input(ensureDailySchema)
      .mutation(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        await store.ensureDaily(familyId, input.date);
        emit(ctx, 'tasks.ensureDaily', familyId);
        return;
      }),
    // S9（A04/D）：支持分页，避免无上限全表拉取打满内存；默认上限 1000（可被 TASKS_LIST_LIMIT 覆盖），
    // 高于既有压测规模（500 任务），不破坏现有调用方。
    all: authedProcedure
      .input(z.object({ limit: z.number().int().min(1).max(5000).optional(), offset: z.number().int().min(0).optional() }).optional())
      .query(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        const limit = input?.limit ?? Number(process.env.TASKS_LIST_LIMIT ?? 1000);
        const offset = input?.offset ?? 0;
        return store.listAllTasks(familyId, limit, offset);
      }),
    create: authedProcedure
      .input(createTaskSchema)
      .mutation(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        const r = await store.createTask(familyId, input);
        emit(ctx, 'tasks.create', familyId, r.id);
        return r;
      }),
    complete: authedProcedure
      .input(completeTaskSchema)
      .mutation(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        const r = await store.completeTask(familyId, input);
        emit(ctx, 'tasks.complete', familyId, r.id);
        return r;
      }),
    uncomplete: authedProcedure
      .input(uncompleteTaskSchema)
      .mutation(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        const r = await store.uncompleteTask(familyId, input);
        emit(ctx, 'tasks.uncomplete', familyId, r.id);
        return r;
      }),
    setQuadrant: authedProcedure
      .input(setQuadrantSchema)
      .mutation(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        const r = await store.setQuadrant(familyId, input);
        emit(ctx, 'tasks.setQuadrant', familyId, r.id);
        return r;
      }),
    schedule: authedProcedure
      .input(scheduleTaskSchema)
      .mutation(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        const r = await store.scheduleTask(familyId, input);
        emit(ctx, 'tasks.schedule', familyId, r.id);
        return r;
      }),
    setMit: authedProcedure
      .input(setMitSchema)
      .mutation(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        const r = await store.setMit(familyId, input);
        emit(ctx, 'tasks.setMit', familyId, r.id);
        return r;
      }),
    update: authedProcedure
      .input(updateTaskSchema)
      .mutation(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        const r = await store.updateTask(familyId, input);
        emit(ctx, 'tasks.update', familyId, r.id);
        return r;
      }),
    delete: authedProcedure
      .input(deleteTaskSchema)
      .mutation(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        await store.deleteTask(familyId, input);
        emit(ctx, 'tasks.delete', familyId, input.id);
        return;
      }),
  }),

  interests: router({
    capture: authedProcedure
      .input(captureInterestSchema)
      .mutation(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        const r = await store.captureInterest(familyId, input);
        emit(ctx, 'interests.capture', familyId, r.id);
        return r;
      }),
    list: authedProcedure
      .input(interestReviewQuerySchema.optional())
      .query(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        return store.listInterests(familyId, input?.status ? { status: input.status } : undefined);
      }),
    update: authedProcedure
      .input(updateInterestSchema)
      .mutation(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        const r = await store.updateInterest(familyId, input);
        emit(ctx, 'interests.update', familyId, r.id);
        return r;
      }),
    setStatus: authedProcedure
      .input(setInterestStatusSchema)
      .mutation(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        const r = await store.setInterestStatus(familyId, input);
        emit(ctx, 'interests.setStatus', familyId, r.id);
        return r;
      }),
    validate: authedProcedure
      .input(validateInterestSchema)
      .mutation(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        const r = await store.validateInterest(familyId, input);
        emit(ctx, 'interests.validate', familyId, r.id);
        return r;
      }),
    convert: authedProcedure
      .input(convertInterestSchema)
      .mutation(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        const r = await store.convertInterest(familyId, input);
        emit(ctx, 'interests.convert', familyId, r.id);
        return r;
      }),
    recordView: authedProcedure
      .input(z.object({ id: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        const r = await store.recordInterestView(familyId, input);
        emit(ctx, 'interests.recordView', familyId, r.id);
        return r;
      }),
    review: authedProcedure
      .input(interestReviewQuerySchema.optional())
      .query(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        return store.reviewInterests(familyId, input ?? {});
      }),
  }),

  domains: router({
    list: authedProcedure.query(async ({ ctx }) => {
      const familyId = await store.getPersonalFamilyId(ctx.userId);
      return store.listDomains(familyId);
    }),
    summary: authedProcedure.query(async ({ ctx }) => {
      const familyId = await store.getPersonalFamilyId(ctx.userId);
      return store.summaryDomains(familyId);
    }),
    balanceWheel: authedProcedure
      .input(z.object({ week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'week 需为 YYYY-MM-DD（周一）') }))
      .query(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        return store.balanceWheel(familyId, input.week);
      }),
  }),

  projects: router({
    list: authedProcedure.query(async ({ ctx }) => {
      const familyId = await store.getPersonalFamilyId(ctx.userId);
      return store.listProjects(familyId);
    }),
    create: authedProcedure
      .input(createProjectSchema)
      .mutation(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        const r = await store.createProject(familyId, input);
        emit(ctx, 'projects.create', familyId, r.id);
        return r;
      }),
  }),

  notes: router({
    ingest: authedProcedure
      .input(ingestNoteSchema)
      .mutation(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        const id = await store.ingestNote(familyId, input);
        emit(ctx, 'notes.ingest', familyId, id);
        return id;
      }),
    update: authedProcedure
      .input(updateNoteSchema)
      .mutation(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        const result = await store.updateNote(familyId, input);
        emit(ctx, 'notes.update', familyId, input.id);
        return result;
      }),
    delete: authedProcedure
      .input(deleteNoteSchema)
      .mutation(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        await store.deleteNote(familyId, input);
        emit(ctx, 'notes.delete', familyId, input.id);
      }),
    list: authedProcedure
      .input(z.object({ kind: z.enum(['idea', 'notebook']).optional() }).optional())
      .query(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        return store.listNotes(familyId, input?.kind);
      }),
  }),

  knowledge: router({
    // 语义检索：server 无浏览器 embedding 模型，采用 token-overlap 兜底（见 store.semanticSearch）
    semanticSearch: authedProcedure
      .input(z.object({ query: z.string().min(1), k: z.number().int().min(1).max(20).optional() }))
      .query(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        return store.semanticSearch(familyId, input.query, input.k ?? 5);
      }),
  }),

  insights: router({
    dailyCard: authedProcedure
      .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).optional())
      .query(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        return store.dailyCard(familyId, input?.date);
      }),
    pressure: authedProcedure.query(async ({ ctx }) => {
      const familyId = await store.getPersonalFamilyId(ctx.userId);
      return store.pressureBackpack(familyId);
    }),
  }),

  finance: router({
    debts: router({
      list: authedProcedure.query(async ({ ctx }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        return store.listDebts(familyId);
      }),
      create: authedProcedure
        .input(createDebtSchema)
        .mutation(async ({ ctx, input }) => {
          const familyId = await store.getPersonalFamilyId(ctx.userId);
          const r = await store.createDebt(familyId, input);
          emit(ctx, 'finance.debtCreate', familyId, r.id);
          return r;
        }),
      update: authedProcedure
        .input(updateDebtSchema)
        .mutation(async ({ ctx, input }) => {
          const familyId = await store.getPersonalFamilyId(ctx.userId);
          const r = await store.updateDebt(familyId, input);
          emit(ctx, 'finance.debtUpdate', familyId, r.id);
          return r;
        }),
      close: authedProcedure
        .input(closeDebtSchema)
        .mutation(async ({ ctx, input }) => {
          const familyId = await store.getPersonalFamilyId(ctx.userId);
          const r = await store.closeDebt(familyId, input);
          emit(ctx, 'finance.debtClose', familyId, r.id);
          return r;
        }),
      reopen: authedProcedure
        .input(reopenDebtSchema)
        .mutation(async ({ ctx, input }) => {
          const familyId = await store.getPersonalFamilyId(ctx.userId);
          const r = await store.reopenDebt(familyId, input);
          emit(ctx, 'finance.debtReopen', familyId, r.id);
          return r;
        }),
      delete: authedProcedure
        .input(deleteDebtSchema)
        .mutation(async ({ ctx, input }) => {
          const familyId = await store.getPersonalFamilyId(ctx.userId);
          await store.deleteDebt(familyId, input);
          emit(ctx, 'finance.debtDelete', familyId, input.id);
          return;
        }),
    }),
    incomes: router({
      list: authedProcedure.query(async ({ ctx }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        return store.listIncomes(familyId);
      }),
      record: authedProcedure
        .input(recordIncomeSchema)
        .mutation(async ({ ctx, input }) => {
          const familyId = await store.getPersonalFamilyId(ctx.userId);
          const r = await store.recordIncome(familyId, input);
          emit(ctx, 'finance.incomeRecord', familyId, r.id);
          return r;
        }),
      update: authedProcedure
        .input(updateIncomeSchema)
        .mutation(async ({ ctx, input }) => {
          const familyId = await store.getPersonalFamilyId(ctx.userId);
          const r = await store.updateIncome(familyId, input);
          emit(ctx, 'finance.incomeUpdate', familyId, r.id);
          return r;
        }),
      delete: authedProcedure
        .input(deleteIncomeSchema)
        .mutation(async ({ ctx, input }) => {
          const familyId = await store.getPersonalFamilyId(ctx.userId);
          await store.deleteIncome(familyId, input);
          emit(ctx, 'finance.incomeDelete', familyId, input.id);
          return;
        }),
    }),
    transactions: router({
      list: authedProcedure.query(async ({ ctx }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        return store.listTransactions(familyId);
      }),
      record: authedProcedure
        .input(recordTransactionSchema)
        .mutation(async ({ ctx, input }) => {
          const familyId = await store.getPersonalFamilyId(ctx.userId);
          const r = await store.recordTransaction(familyId, input);
          emit(ctx, 'finance.transactionRecord', familyId, r.id);
          return r;
        }),
      update: authedProcedure
        .input(updateTransactionSchema)
        .mutation(async ({ ctx, input }) => {
          const familyId = await store.getPersonalFamilyId(ctx.userId);
          const r = await store.updateTransaction(familyId, input);
          emit(ctx, 'finance.transactionUpdate', familyId, r.id);
          return r;
        }),
      delete: authedProcedure
        .input(deleteTransactionSchema)
        .mutation(async ({ ctx, input }) => {
          const familyId = await store.getPersonalFamilyId(ctx.userId);
          await store.deleteTransaction(familyId, input);
          emit(ctx, 'finance.transactionDelete', familyId, input.id);
          return;
        }),
    }),
    assets: router({
      list: authedProcedure.query(async ({ ctx }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        return store.listAssets(familyId);
      }),
      record: authedProcedure
        .input(recordAssetSchema)
        .mutation(async ({ ctx, input }) => {
          const familyId = await store.getPersonalFamilyId(ctx.userId);
          const r = await store.recordAsset(familyId, input);
          emit(ctx, 'finance.assetRecord', familyId, r.id);
          return r;
        }),
      update: authedProcedure
        .input(updateAssetSchema)
        .mutation(async ({ ctx, input }) => {
          const familyId = await store.getPersonalFamilyId(ctx.userId);
          const r = await store.updateAsset(familyId, input);
          emit(ctx, 'finance.assetUpdate', familyId, r.id);
          return r;
        }),
      delete: authedProcedure
        .input(deleteAssetSchema)
        .mutation(async ({ ctx, input }) => {
          const familyId = await store.getPersonalFamilyId(ctx.userId);
          await store.deleteAsset(familyId, input);
          emit(ctx, 'finance.assetDelete', familyId, input.id);
          return;
        }),
    }),
    budgets: router({
      list: authedProcedure.query(async ({ ctx }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        return store.listBudgets(familyId);
      }),
      create: authedProcedure
        .input(createBudgetSchema)
        .mutation(async ({ ctx, input }) => {
          const familyId = await store.getPersonalFamilyId(ctx.userId);
          const r = await store.createBudget(familyId, input);
          emit(ctx, 'finance.budgetCreate', familyId, r.id);
          return r;
        }),
      update: authedProcedure
        .input(updateBudgetSchema)
        .mutation(async ({ ctx, input }) => {
          const familyId = await store.getPersonalFamilyId(ctx.userId);
          const r = await store.updateBudget(familyId, input);
          emit(ctx, 'finance.budgetUpdate', familyId, r.id);
          return r;
        }),
      delete: authedProcedure
        .input(deleteBudgetSchema)
        .mutation(async ({ ctx, input }) => {
          const familyId = await store.getPersonalFamilyId(ctx.userId);
          await store.deleteBudget(familyId, input);
          emit(ctx, 'finance.budgetDelete', familyId, input.id);
          return;
        }),
    }),
    transfers: router({
      list: authedProcedure
        .input(transferListSchema)
        .query(async ({ ctx, input }) => {
          const familyId = await store.getPersonalFamilyId(ctx.userId);
          return store.listTransfers(familyId, input);
        }),
      create: authedProcedure
        .input(transferCreateSchema)
        .mutation(async ({ ctx, input }) => {
          const familyId = await store.getPersonalFamilyId(ctx.userId);
          const r = await store.createTransfer(familyId, input);
          emit(ctx, 'finance.transferCreate', familyId, r.id);
          return r;
        }),
      get: authedProcedure
        .input(transferGetSchema)
        .query(async ({ ctx, input }) => {
          const familyId = await store.getPersonalFamilyId(ctx.userId);
          return store.getTransfer(familyId, input.id);
        }),
      reverse: authedProcedure
        .input(transferReverseSchema)
        .mutation(async ({ ctx, input }) => {
          const familyId = await store.getPersonalFamilyId(ctx.userId);
          const r = await store.reverseTransfer(familyId, { id: input.id });
          emit(ctx, 'finance.transferReverse', familyId, r.id);
          return r;
        }),
    }),
    summary: authedProcedure.query(async ({ ctx }) => {
      const familyId = await store.getPersonalFamilyId(ctx.userId);
      return store.financeSummary(familyId);
    }),
    debtSchedule: authedProcedure
      .input(z.object({ id: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        return store.debtSchedule(familyId, input.id);
      }),
    debtProgressSummary: authedProcedure.query(async ({ ctx }) => {
      const familyId = await store.getPersonalFamilyId(ctx.userId);
      return store.debtProgressSummary(familyId);
    }),
    debtPayoffAdvice: authedProcedure
      .input(z.object({ mode: z.enum(['avalanche', 'snowball']) }))
      .query(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        return store.debtPayoffAdvice(familyId, input.mode);
      }),
    trend: authedProcedure
      .input(z.object({ months: z.number().int().min(1).max(24).optional() }))
      .query(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        return store.financeMonthlyTrend(familyId, input.months ?? 6);
      }),
    reconcile: authedProcedure.query(async ({ ctx }) => {
      const familyId = await store.getPersonalFamilyId(ctx.userId);
      return store.financeReconcile(familyId);
    }),
    exportReport: authedProcedure
      .input(exportReportInputSchema)
      .query(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        return store.financeExportReport(familyId, input);
      }),
    autoRefresh: authedProcedure.mutation(async ({ ctx }) => {
      const familyId = await store.getPersonalFamilyId(ctx.userId);
      const r = await store.financeAutoRefresh(familyId);
      emit(ctx, 'finance.autoRefresh', familyId);
      return r;
    }),
  }),

  reminders: router({
    list: authedProcedure.query(async ({ ctx }) => {
      const familyId = await store.getPersonalFamilyId(ctx.userId);
      return store.listClocks(familyId);
    }),
    upcoming: authedProcedure
      .input(z.object({ horizon: z.string().optional() }).optional())
      .query(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        const horizon = input?.horizon ?? new Date(Date.now() + 30 * 86400000).toISOString();
        return store.listUpcoming(familyId, horizon);
      }),
    create: authedProcedure
      .input(createReminderSchema)
      .mutation(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        const r = await store.createReminder(familyId, input);
        emit(ctx, 'reminders.create', familyId, r.id);
        return r;
      }),
    complete: authedProcedure
      .input(completeReminderSchema)
      .mutation(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        const r = await store.completeReminder(familyId, input);
        emit(ctx, 'reminders.complete', familyId, r.id);
        return r;
      }),
    rewind: authedProcedure
      .input(rewindReminderSchema)
      .mutation(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        const r = await store.rewindReminder(familyId, input);
        emit(ctx, 'reminders.rewind', familyId, r.id);
        return r;
      }),
    snooze: authedProcedure
      .input(snoozeReminderSchema)
      .mutation(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        const r = await store.snoozeReminder(familyId, input);
        emit(ctx, 'reminders.snooze', familyId, r.id);
        return r;
      }),
    update: authedProcedure
      .input(updateReminderSchema)
      .mutation(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        const r = await store.updateReminder(familyId, input);
        emit(ctx, 'reminders.update', familyId, r.id);
        return r;
      }),
    delete: authedProcedure
      .input(deleteReminderSchema)
      .mutation(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        await store.deleteReminder(familyId, input);
        emit(ctx, 'reminders.delete', familyId, input.id);
        return;
      }),
    tick: authedProcedure.mutation(async ({ ctx }) => {
      const familyId = await store.getPersonalFamilyId(ctx.userId);
      const r = await store.tickReminders(familyId);
      emit(ctx, 'reminders.tick', familyId);
      return r;
    }),
  }),

  flow: router({
    record: authedProcedure
      .input(recordFocusSessionSchema)
      .mutation(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        const id = await store.recordSession(familyId, input);
        emit(ctx, 'flow.record', familyId, id);
        return id;
      }),
    list: authedProcedure.query(async ({ ctx }) => {
      const familyId = await store.getPersonalFamilyId(ctx.userId);
      return store.listSessions(familyId);
    }),
    summary: authedProcedure
      .input(flowSummaryQuerySchema)
      .query(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        return store.summarizeFlow(familyId, input);
      }),
  }),

  system: router({
    exportAll: authedProcedure.query(async ({ ctx }) => {
      const familyId = await store.getPersonalFamilyId(ctx.userId);
      const data = await store.exportPersonalData(familyId);
      return { ok: true, exportedAt: new Date().toISOString(), data };
    }),
    importAll: authedProcedure
      .input(z.object({ bundle: z.any().optional() }))
      .mutation(async ({ ctx, input }) => {
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        if (!input?.bundle || typeof input.bundle !== 'object' || Array.isArray(input.bundle)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '无效的备份文件' });
        }
        // S7（A04）：仅允许已知个人域表名，拒绝未知键（防御写入非预期表 / 列）
        const KNOWN_IMPORT_TABLES = new Set([
          'domains', 'projects', 'tasks', 'interests', 'notes', 'debts',
          'incomes', 'transactions', 'assets', 'budgets', 'reminderClocks', 'focusSessions', 'financeTransfers',
        ]);
        for (const key of Object.keys(input.bundle)) {
          if (!KNOWN_IMPORT_TABLES.has(key)) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: `未知备份表 ${key}，导入被拒绝` });
          }
        }
        // 体积上限 + 形状校验：避免超大包打满内存，且保证值为数组（与 exportAll 结构一致）
        const MAX_IMPORT_BYTES = Number(process.env.IMPORT_MAX_BYTES ?? 20 * 1024 * 1024);
        const serialized = JSON.stringify(input.bundle);
        if (serialized.length > MAX_IMPORT_BYTES) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '备份文件过大' });
        }
        for (const [k, v] of Object.entries(input.bundle as Record<string, unknown>)) {
          if (!Array.isArray(v)) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: `备份文件格式非法：键 ${k} 的值应为数组` });
          }
        }
        const imported = await store.importPersonalData(familyId, input.bundle as Record<string, unknown[]>);
        emit(ctx, 'system.import', familyId);
        return { ok: true, imported, note: '数据已按 family 隔离恢复' };
      }),
    dataStatus: authedProcedure.query(async ({ ctx }) => {
      const familyId = await store.getPersonalFamilyId(ctx.userId);
      return store.systemDataStatus(familyId);
    }),
    setCustomDataDir: authedProcedure
      .input(z.object({ dir: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        // S2（A01）：仅共享家庭的所有者/管理员可改全局数据目录；个人模式用户仅有 personal family，自然被拒。
        const memberships = await store.getMembershipsByUser(ctx.userId);
        let elevated = false;
        for (const m of memberships) {
          if (m.role !== 'owner' && m.role !== 'admin') continue;
          const fam = await store.getFamily(m.familyId);
          if (fam && fam.kind === 'shared') {
            elevated = true;
            break;
          }
        }
        if (!elevated) {
          throw new TRPCError({ code: 'FORBIDDEN', message: '仅家庭所有者/管理员可更改数据目录' });
        }

        const fs = await import('node:fs');
        const os = await import('node:os');
        const path = await import('node:path');
        // F4 修复：规范化路径 + 可写性校验，避免落盘到非法/不可写目录导致重启后 /health 503 且无回滚
        let resolved: string;
        try {
          resolved = path.resolve(input.dir);
        } catch {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '数据目录路径非法' });
        }
        // 注意：Windows 绝对路径形如 C:\...，盘符后的冒号属合法，需先剥离盘符再检测非法字符，
        // 否则会把任何绝对路径误判为「含非法字符」而拒绝（跨平台一致性）。
        const resolvedNoDrive = resolved.replace(/^[A-Za-z]:/, '');
        if (resolved === '' || /[<>:"|?*]/.test(resolvedNoDrive)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '数据目录路径包含非法字符' });
        }
        // S2（A01）：路径白名单——目标目录必须位于 PGLITE_DIR_ALLOWED（冒号分隔，可空）列出的基目录内，
        // 或默认限制为当前数据根（PGLITE_DIR 或 ~/.dm-life/data）的子目录；否则拒绝，避免任意落盘到系统目录。
        const allowedBases = (process.env.PGLITE_DIR_ALLOWED ?? '')
          .split(':')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => path.resolve(s));
        const dataRoot = process.env.PGLITE_DIR
          ? path.resolve(process.env.PGLITE_DIR)
          : path.join(os.homedir(), '.dm-life', 'data');
        const bases = allowedBases.length > 0 ? allowedBases : [dataRoot];
        const isAllowed = bases.some((base) => {
          const rel = path.relative(base, resolved);
          return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
        });
        if (!isAllowed) {
          throw new TRPCError({ code: 'FORBIDDEN', message: '数据目录不在允许的基目录内' });
        }
        const probe = path.join(resolved, '.dm-life-write-probe');
        try {
          fs.mkdirSync(resolved, { recursive: true });
          fs.writeFileSync(probe, 'ok');
          fs.unlinkSync(probe);
        } catch {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '数据目录不可写，请更换路径' });
        }
        const cfgPath = path.join(os.homedir(), '.dm-life', 'config.json');
        let cfg: Record<string, unknown> = {};
        try {
          if (fs.existsSync(cfgPath)) cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        } catch {
          /* 损坏则覆盖 */
        }
        cfg.pgliteDir = resolved;
        fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
        fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), { mode: 0o600 });
        // F4 修复：emit 的广播键应为 familyId（userId 非 familyId，原写法落入空桶被静默丢弃）
        const familyId = await store.getPersonalFamilyId(ctx.userId);
        emit(ctx, 'system.setCustomDataDir', familyId);
        return { ok: true, dir: resolved, note: '已保存数据目录配置；重启后端服务后生效（新目录需为空或含有效 PGlite 数据）' };
      }),
  }),
};
