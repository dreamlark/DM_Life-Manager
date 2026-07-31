import io, re

path = r"D:\DMYY\DM_LifeManager-review\packages\server\src\store.ts"
with io.open(path, "r", encoding="utf-8") as f:
    content = f.read()

for name in ['completeReminder', 'rewindReminder', 'snoozeReminder', 'updateReminder']:
    pat = re.compile(r'(async ' + re.escape(name) + r'\([^)]*\)): Promise<ReminderView> \{')
    m = pat.search(content)
    if not m:
        raise SystemExit('NOT FOUND: ' + name)
    repl = m.group(1) + ': Promise<ReminderView & { conflict: boolean; latestData: ReminderView }> {'
    content = pat.sub(repl, content, 1)
    print('widened', name)

with io.open(path, "w", encoding="utf-8") as f:
    f.write(content)
print('reminder return types widened')
