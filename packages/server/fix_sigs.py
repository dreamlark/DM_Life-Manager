import io, re

path = r"D:\DMYY\DM_LifeManager-review\packages\server\src\store.ts"
with io.open(path, "r", encoding="utf-8") as f:
    content = f.read()

# NAME -> correct param name used by body
mapping = {
    'completeTask': 'input', 'uncompleteTask': 'input', 'setQuadrant': 'input', 'scheduleTask': 'input', 'setMit': 'input',
    'updateTask': 'data', 'updateInterest': 'data', 'setInterestStatus': 'input', 'recordInterestView': 'input',
    'updateDebt': 'data', 'closeDebt': 'input', 'reopenDebt': 'input', 'updateIncome': 'data', 'updateTransaction': 'data',
    'updateAsset': 'data', 'updateBudget': 'data', 'updateNote': 'data', 'completeReminder': 'input',
    'rewindReminder': 'input', 'snoozeReminder': 'input', 'updateReminder': 'data',
    'validateInterest': 'input', 'convertInterest': 'input',
}
# functions whose body now returns {...view, conflict, latestData} -> widen return type
augment = {
    'completeTask', 'uncompleteTask', 'setQuadrant', 'scheduleTask', 'setMit', 'updateTask', 'updateInterest',
    'setInterestStatus', 'recordInterestView', 'updateDebt', 'closeDebt', 'reopenDebt', 'updateIncome',
    'updateTransaction', 'updateAsset', 'updateBudget', 'completeReminder', 'rewindReminder', 'snoozeReminder', 'updateReminder',
}

for name, param in mapping.items():
    pat = re.compile(
        r'async ' + re.escape(name) + r'\(familyId: string, ' + re.escape(name) +
        r'(, expectedVersion\?: number)?\): Promise<([^>]+)> \{'
    )
    m = pat.search(content)
    if not m:
        print('SKIP (already has typed param, handled elsewhere): ' + name)
        continue
    has_ev = m.group(1)
    typ = m.group(2)
    newtype = (typ + ' & { conflict: boolean; latestData: ' + typ + ' }') if name in augment else typ
    ev = ', expectedVersion?: number' if has_ev else ''
    repl = 'async ' + name + '(familyId: string, ' + param + ': any' + ev + '): Promise<' + newtype + '> {'
    content = pat.sub(repl, content, 1)
    print('fixed', name, '->', param, '| return:', newtype)

with io.open(path, "w", encoding="utf-8") as f:
    f.write(content)
print('store.ts signatures fixed')
