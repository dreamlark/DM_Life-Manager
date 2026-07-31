import io, sys

path = r"D:\DMYY\DM_LifeManager-review\packages\server\src\store.ts"
with io.open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Each replacement: (old, new, allow_multiple)
repls = []

# ---- reminder signatures: add expectedVersion param ----
repls.append((
    "async completeReminder(familyId: string, input: { id: string }): Promise<ReminderView> {",
    "async completeReminder(familyId: string, input: { id: string }, expectedVersion?: number): Promise<ReminderView> {",
    False,
))
repls.append((
    "async rewindReminder(familyId: string, input: { id: string; nextFireAt: string }): Promise<ReminderView> {",
    "async rewindReminder(familyId: string, input: { id: string; nextFireAt: string }, expectedVersion?: number): Promise<ReminderView> {",
    False,
))
repls.append((
    "async snoozeReminder(familyId: string, input: { id: string; nextFireAt: string }): Promise<ReminderView> {",
    "async snoozeReminder(familyId: string, input: { id: string; nextFireAt: string }, expectedVersion?: number): Promise<ReminderView> {",
    False,
))
repls.append((
    "async updateReminder(familyId: string, data: any): Promise<ReminderView> {",
    "async updateReminder(familyId: string, data: any, expectedVersion?: number): Promise<ReminderView> {",
    False,
))

# ---- task sub-updaters: convert raw update -> bumpVersionAndEdit + surface conflict ----
repls.append((
    "    await db\n      .update(tasks)\n      .set({ status: 'done', completedAt, completionQuality: input.quality ?? null, attentionPeak, updatedAt: completedAt })\n      .where(and(resolveZone(tasks, familyId), eq(tasks.id, input.id)));\n    return (await store.getTask(familyId, input.id))!;",
    "    const set: Record<string, unknown> = { status: 'done', completedAt, completionQuality: input.quality ?? null, attentionPeak, updatedAt: completedAt };\n    const { conflict } = await bumpVersionAndEdit(tasks, input.id, familyId, set, expectedVersion);\n    const view = (await store.getTask(familyId, input.id))!;\n    return { ...view, conflict, latestData: view };",
    False,
))
repls.append((
    "    await db\n      .update(tasks)\n      .set({ status: 'todo', completedAt: null, completionQuality: null, attentionPeak: null, updatedAt: now })\n      .where(and(resolveZone(tasks, familyId), eq(tasks.id, input.id)));\n    return (await store.getTask(familyId, input.id))!;",
    "    const set: Record<string, unknown> = { status: 'todo', completedAt: null, completionQuality: null, attentionPeak: null, updatedAt: now };\n    const { conflict } = await bumpVersionAndEdit(tasks, input.id, familyId, set, expectedVersion);\n    const view = (await store.getTask(familyId, input.id))!;\n    return { ...view, conflict, latestData: view };",
    False,
))
repls.append((
    "    await db\n      .update(tasks)\n      .set({ importance: input.importance, urgency: input.urgency, updatedAt: new Date().toISOString() })\n      .where(and(resolveZone(tasks, familyId), eq(tasks.id, input.id)));\n    return (await store.getTask(familyId, input.id))!;",
    "    const set: Record<string, unknown> = { importance: input.importance, urgency: input.urgency, updatedAt: new Date().toISOString() };\n    const { conflict } = await bumpVersionAndEdit(tasks, input.id, familyId, set, expectedVersion);\n    const view = (await store.getTask(familyId, input.id))!;\n    return { ...view, conflict, latestData: view };",
    False,
))
repls.append((
    "    await db\n      .update(tasks)\n      .set({ scheduledStart: input.scheduledStart, scheduledEnd: input.scheduledEnd, updatedAt: new Date().toISOString() })\n      .where(and(resolveZone(tasks, familyId), eq(tasks.id, input.id)));\n    return (await store.getTask(familyId, input.id))!;",
    "    const set: Record<string, unknown> = { scheduledStart: input.scheduledStart, scheduledEnd: input.scheduledEnd, updatedAt: new Date().toISOString() };\n    const { conflict } = await bumpVersionAndEdit(tasks, input.id, familyId, set, expectedVersion);\n    const view = (await store.getTask(familyId, input.id))!;\n    return { ...view, conflict, latestData: view };",
    False,
))
repls.append((
    "    await db\n      .update(tasks)\n      .set({ isMit: input.isMit, mitOrder: input.mitOrder ?? null, updatedAt: new Date().toISOString() })\n      .where(and(resolveZone(tasks, familyId), eq(tasks.id, input.id)));\n    return (await store.getTask(familyId, input.id))!;",
    "    const set: Record<string, unknown> = { isMit: input.isMit, mitOrder: input.mitOrder ?? null, updatedAt: new Date().toISOString() };\n    const { conflict } = await bumpVersionAndEdit(tasks, input.id, familyId, set, expectedVersion);\n    const view = (await store.getTask(familyId, input.id))!;\n    return { ...view, conflict, latestData: view };",
    False,
))

# ---- simple bumpVersionAndEdit + store view return ----
def simple(table, id_expr, getter):
    old = (
        "    await bumpVersionAndEdit(%s, %s, familyId, set, expectedVersion);\n"
        "    return (await store.%s(familyId, %s))!;"
    ) % (table, id_expr, getter, id_expr)
    new = (
        "    const { conflict } = await bumpVersionAndEdit(%s, %s, familyId, set, expectedVersion);\n"
        "    const view = (await store.%s(familyId, %s))!;\n"
        "    return { ...view, conflict, latestData: view };"
    ) % (table, id_expr, getter, id_expr)
    return (old, new, False)

repls.append(simple("tasks", "id", "getTask"))
repls.append(simple("interests", "id", "getInterestView"))
repls.append(simple("interests", "input.id", "getInterestView"))
repls.append(simple("debts", "data.id", "getDebtView"))
repls.append(simple("incomes", "data.id", "getIncomeView"))
repls.append(simple("transactions", "data.id", "getTransactionView"))
repls.append(simple("assets", "data.id", "getAssetView"))

# recordInterestView (inline set)
repls.append((
    "    await bumpVersionAndEdit(interests, input.id, familyId, { viewCount: sql`${interests.viewCount} + 1`, updatedAt: new Date().toISOString() }, expectedVersion);\n    return (await store.getInterestView(familyId, input.id))!;",
    "    const { conflict } = await bumpVersionAndEdit(interests, input.id, familyId, { viewCount: sql`${interests.viewCount} + 1`, updatedAt: new Date().toISOString() }, expectedVersion);\n    const view = (await store.getInterestView(familyId, input.id))!;\n    return { ...view, conflict, latestData: view };",
    False,
))
# closeDebt / reopenDebt
repls.append((
    "    await bumpVersionAndEdit(debts, input.id, familyId, { status: 'paid', updatedAt: new Date().toISOString() }, expectedVersion);\n    return (await store.getDebtView(familyId, input.id))!;",
    "    const { conflict } = await bumpVersionAndEdit(debts, input.id, familyId, { status: 'paid', updatedAt: new Date().toISOString() }, expectedVersion);\n    const view = (await store.getDebtView(familyId, input.id))!;\n    return { ...view, conflict, latestData: view };",
    False,
))
repls.append((
    "    await bumpVersionAndEdit(debts, input.id, familyId, { status: 'active', updatedAt: new Date().toISOString() }, expectedVersion);\n    return (await store.getDebtView(familyId, input.id))!;",
    "    const { conflict } = await bumpVersionAndEdit(debts, input.id, familyId, { status: 'active', updatedAt: new Date().toISOString() }, expectedVersion);\n    const view = (await store.getDebtView(familyId, input.id))!;\n    return { ...view, conflict, latestData: view };",
    False,
))
# updateBudget (uses listBudgets find)
repls.append((
    "    await bumpVersionAndEdit(budgets, data.id, familyId, set, expectedVersion);\n    const all = await store.listBudgets(familyId);\n    return all.find((b) => b.id === data.id)!;",
    "    const { conflict } = await bumpVersionAndEdit(budgets, data.id, familyId, set, expectedVersion);\n    const all = await store.listBudgets(familyId);\n    const view = all.find((b) => b.id === data.id)!;\n    return { ...view, conflict, latestData: view };",
    False,
))

# reminder bodies (complete uses `set`; rewind/snooze identical; updateReminder uses data.id)
repls.append((
    "    await bumpVersionAndEdit(reminderClocks, input.id, familyId, set, expectedVersion);\n    const rows = await db.select().from(reminderClocks).where(and(resolveZone(reminderClocks, familyId), eq(reminderClocks.id, input.id))).limit(1);\n    return reminderRowToView(rows[0]!);",
    "    const { conflict } = await bumpVersionAndEdit(reminderClocks, input.id, familyId, set, expectedVersion);\n    const rows = await db.select().from(reminderClocks).where(and(resolveZone(reminderClocks, familyId), eq(reminderClocks.id, input.id))).limit(1);\n    const view = reminderRowToView(rows[0]!);\n    return { ...view, conflict, latestData: view };",
    False,
))
# rewind + snooze share this exact body
repls.append((
    "    await bumpVersionAndEdit(reminderClocks, input.id, familyId, { nextFireAt: input.nextFireAt, status: 'active', updatedAt: new Date().toISOString() }, expectedVersion);\n    const rows = await db.select().from(reminderClocks).where(and(resolveZone(reminderClocks, familyId), eq(reminderClocks.id, input.id))).limit(1);\n    return reminderRowToView(rows[0]!);",
    "    const { conflict } = await bumpVersionAndEdit(reminderClocks, input.id, familyId, { nextFireAt: input.nextFireAt, status: 'active', updatedAt: new Date().toISOString() }, expectedVersion);\n    const rows = await db.select().from(reminderClocks).where(and(resolveZone(reminderClocks, familyId), eq(reminderClocks.id, input.id))).limit(1);\n    const view = reminderRowToView(rows[0]!);\n    return { ...view, conflict, latestData: view };",
    True,
))
repls.append((
    "    await bumpVersionAndEdit(reminderClocks, data.id, familyId, set, expectedVersion);\n    const rows = await db.select().from(reminderClocks).where(and(resolveZone(reminderClocks, familyId), eq(reminderClocks.id, data.id))).limit(1);\n    return reminderRowToView(rows[0]!);",
    "    const { conflict } = await bumpVersionAndEdit(reminderClocks, data.id, familyId, set, expectedVersion);\n    const rows = await db.select().from(reminderClocks).where(and(resolveZone(reminderClocks, familyId), eq(reminderClocks.id, data.id))).limit(1);\n    const view = reminderRowToView(rows[0]!);\n    return { ...view, conflict, latestData: view };",
    False,
))

errors = []
for old, new, multi in repls:
    cnt = content.count(old)
    if multi:
        if cnt == 0:
            errors.append("MULTI not found: " + old[:60])
        content = content.replace(old, new)
    else:
        if cnt != 1:
            errors.append("EXPECTED 1 GOT %d: %s" % (cnt, old[:80]))
        content = content.replace(old, new, 1)

if errors:
    print("ERRORS:")
    for e in errors:
        print("  " + e)
    sys.exit(1)

with io.open(path, "w", encoding="utf-8") as f:
    f.write(content)
print("OK: applied %d replacements" % len(repls))
