import io, re

ensure_path = r"D:\DMYY\DM_LifeManager-review\packages\server\src\db\ensure.ts"
with io.open(ensure_path, "r", encoding="utf-8") as f:
    ensure = f.read()

TABLES = [
    "tasks", "notes", "reminder_clocks", "debts", "incomes", "transactions",
    "assets", "budgets", "interests", "projects", "domains", "focus_sessions",
    "finance_transfers", "system_meta", "calendar_events",
]

elems = []
# --- existing (pre-zone) migrations preserved (each is a single statement) ---
elems.append("  `ALTER TABLE shared_items ADD COLUMN IF NOT EXISTS done boolean NOT NULL DEFAULT false`")
elems.append("  `ALTER TABLE shared_items ADD COLUMN IF NOT EXISTS note text`")
elems.append("  `ALTER TABLE families ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'personal'`")
elems.append("  `ALTER TABLE debts ALTER COLUMN principal TYPE numeric(18,2) USING principal::numeric(18,2)`")
elems.append("  `ALTER TABLE debts ALTER COLUMN apr TYPE numeric(8,4) USING apr::numeric(8,4)`")
elems.append("  `ALTER TABLE debts ALTER COLUMN min_payment TYPE numeric(18,2) USING min_payment::numeric(18,2)`")
elems.append("  `ALTER TABLE debts ALTER COLUMN base_rate TYPE numeric(8,4) USING base_rate::numeric(8,4)`")
elems.append("  `ALTER TABLE debts ALTER COLUMN rate_spread TYPE numeric(8,4) USING rate_spread::numeric(8,4)`")
elems.append("  `ALTER TABLE incomes ALTER COLUMN amount TYPE numeric(18,2) USING amount::numeric(18,2)`")
elems.append("  `ALTER TABLE incomes ALTER COLUMN monthly_avg TYPE numeric(18,2) USING monthly_avg::numeric(18,2)`")
elems.append("  `ALTER TABLE transactions ALTER COLUMN amount TYPE numeric(18,2) USING amount::numeric(18,2)`")
elems.append("  `ALTER TABLE assets ALTER COLUMN value TYPE numeric(18,2) USING value::numeric(18,2)`")
elems.append("  `ALTER TABLE budgets ALTER COLUMN monthly_limit TYPE numeric(18,2) USING monthly_limit::numeric(18,2)`")
# calendar_events version: guarded DO block (single statement, idempotent)
elems.append(
    "  `DO $$ BEGIN\n"
    "    IF (SELECT data_type FROM information_schema.columns WHERE table_name = 'calendar_events' AND column_name = 'version') <> 'integer' THEN\n"
    "      ALTER TABLE calendar_events ALTER COLUMN version TYPE integer USING COALESCE(EXTRACT(EPOCH FROM version), 1)::integer;\n"
    "    END IF;\n"
    "  END $$`"
)

# --- zone four-column backfill: ONE statement per array element (PGLite prepared stmt safe) ---
for t in TABLES:
    elems.append("  // P1 zone 化：补齐 " + t + " 的 zone 四列")
    elems.append("  `ALTER TABLE " + t + " ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id)`")
    elems.append("  `UPDATE " + t + " SET owner_id = (SELECT owner_id FROM families WHERE families.id = " + t + ".family_id) WHERE owner_id IS NULL`")
    elems.append("  `ALTER TABLE " + t + " ALTER COLUMN owner_id SET NOT NULL`")
    elems.append("  `ALTER TABLE " + t + " ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private'`")
    elems.append("  `ALTER TABLE " + t + " ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1`")
    elems.append("  `ALTER TABLE " + t + " ADD COLUMN IF NOT EXISTS last_edited_by uuid REFERENCES users(id)`")

block = "const COLUMN_MIGRATIONS = [\n" + ",\n".join(elems) + "\n];"

pattern = r"const COLUMN_MIGRATIONS = \[.*?\n\];"
new_ensure, n = re.subn(pattern, block, ensure, count=1, flags=re.S)
assert n == 1, "COLUMN_MIGRATIONS block not replaced (n=%d)" % n
with io.open(ensure_path, "w", encoding="utf-8") as f:
    f.write(new_ensure)
print("ensure.ts COLUMN_MIGRATIONS rebuilt with", len(elems), "elements (single-statement)")
