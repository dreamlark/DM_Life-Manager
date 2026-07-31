-- P1（A/B/D/v2/v3）zone 分区迁移：幂等、可重复执行。
-- 新增 owner_id / visibility / version / last_edited_by 四列；
-- personal 行 -> visibility='private'，shared 快照行 -> visibility='public'；
-- calendar_events.version 由 timestamp 改为 integer；保留 family_id（双写过渡）；
-- 合并 sharedItems / sharedFinanceItems 重复快照（按 updated_at 取最新）；
-- upsert 全零系统用户 SYSTEM_AUTHOR_ID 作为 public 行兜底 owner。

-- 0) 系统用户（FK 锚点）
INSERT INTO users (id, email, name, password_hash, created_at)
VALUES ('00000000-0000-0000-0000-000000000000', 'system@localhost', 'System',
        '<placeholder>', now())
ON CONFLICT (id) DO NOTHING;

-- 0b) 系统家庭（FK 锚点）：注销/迁移时 public 行改挂 SYSTEM_AUTHOR_ID 并迁移到该系统家庭，
--     避免 delete(families) 的 onDelete=cascade 级联误删 public 行。
INSERT INTO families (id, name, owner_id, created_at)
VALUES ('00000000-0000-0000-0000-000000000001', 'System', '00000000-0000-0000-0000-000000000000', now())
ON CONFLICT (id) DO NOTHING;

-- 1) 补齐 zone 四列（幂等）
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id);
UPDATE tasks SET owner_id = (SELECT owner_id FROM families WHERE families.id = tasks.family_id) WHERE owner_id IS NULL;
ALTER TABLE tasks ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS last_edited_by uuid REFERENCES users(id);

ALTER TABLE notes ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id);
UPDATE notes SET owner_id = (SELECT owner_id FROM families WHERE families.id = notes.family_id) WHERE owner_id IS NULL;
ALTER TABLE notes ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private';
ALTER TABLE notes ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS last_edited_by uuid REFERENCES users(id);

ALTER TABLE reminder_clocks ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id);
UPDATE reminder_clocks SET owner_id = (SELECT owner_id FROM families WHERE families.id = reminder_clocks.family_id) WHERE owner_id IS NULL;
ALTER TABLE reminder_clocks ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE reminder_clocks ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private';
ALTER TABLE reminder_clocks ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE reminder_clocks ADD COLUMN IF NOT EXISTS last_edited_by uuid REFERENCES users(id);

ALTER TABLE debts ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id);
UPDATE debts SET owner_id = (SELECT owner_id FROM families WHERE families.id = debts.family_id) WHERE owner_id IS NULL;
ALTER TABLE debts ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE debts ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private';
ALTER TABLE debts ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE debts ADD COLUMN IF NOT EXISTS last_edited_by uuid REFERENCES users(id);

ALTER TABLE incomes ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id);
UPDATE incomes SET owner_id = (SELECT owner_id FROM families WHERE families.id = incomes.family_id) WHERE owner_id IS NULL;
ALTER TABLE incomes ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE incomes ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private';
ALTER TABLE incomes ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE incomes ADD COLUMN IF NOT EXISTS last_edited_by uuid REFERENCES users(id);

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id);
UPDATE transactions SET owner_id = (SELECT owner_id FROM families WHERE families.id = transactions.family_id) WHERE owner_id IS NULL;
ALTER TABLE transactions ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS last_edited_by uuid REFERENCES users(id);

ALTER TABLE assets ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id);
UPDATE assets SET owner_id = (SELECT owner_id FROM families WHERE families.id = assets.family_id) WHERE owner_id IS NULL;
ALTER TABLE assets ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private';
ALTER TABLE assets ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS last_edited_by uuid REFERENCES users(id);

ALTER TABLE budgets ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id);
UPDATE budgets SET owner_id = (SELECT owner_id FROM families WHERE families.id = budgets.family_id) WHERE owner_id IS NULL;
ALTER TABLE budgets ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private';
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS last_edited_by uuid REFERENCES users(id);

ALTER TABLE interests ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id);
UPDATE interests SET owner_id = (SELECT owner_id FROM families WHERE families.id = interests.family_id) WHERE owner_id IS NULL;
ALTER TABLE interests ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE interests ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private';
ALTER TABLE interests ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE interests ADD COLUMN IF NOT EXISTS last_edited_by uuid REFERENCES users(id);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id);
UPDATE projects SET owner_id = (SELECT owner_id FROM families WHERE families.id = projects.family_id) WHERE owner_id IS NULL;
ALTER TABLE projects ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_edited_by uuid REFERENCES users(id);

ALTER TABLE domains ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id);
UPDATE domains SET owner_id = (SELECT owner_id FROM families WHERE families.id = domains.family_id) WHERE owner_id IS NULL;
ALTER TABLE domains ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private';
ALTER TABLE domains ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE domains ADD COLUMN IF NOT EXISTS last_edited_by uuid REFERENCES users(id);

ALTER TABLE focus_sessions ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id);
UPDATE focus_sessions SET owner_id = (SELECT owner_id FROM families WHERE families.id = focus_sessions.family_id) WHERE owner_id IS NULL;
ALTER TABLE focus_sessions ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE focus_sessions ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private';
ALTER TABLE focus_sessions ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE focus_sessions ADD COLUMN IF NOT EXISTS last_edited_by uuid REFERENCES users(id);

ALTER TABLE finance_transfers ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id);
UPDATE finance_transfers SET owner_id = (SELECT owner_id FROM families WHERE families.id = finance_transfers.family_id) WHERE owner_id IS NULL;
ALTER TABLE finance_transfers ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE finance_transfers ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private';
ALTER TABLE finance_transfers ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE finance_transfers ADD COLUMN IF NOT EXISTS last_edited_by uuid REFERENCES users(id);

ALTER TABLE system_meta ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id);
UPDATE system_meta SET owner_id = (SELECT owner_id FROM families WHERE families.id = system_meta.family_id) WHERE owner_id IS NULL;
ALTER TABLE system_meta ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE system_meta ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private';
ALTER TABLE system_meta ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE system_meta ADD COLUMN IF NOT EXISTS last_edited_by uuid REFERENCES users(id);

ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES users(id);
UPDATE calendar_events SET owner_id = (SELECT owner_id FROM families WHERE families.id = calendar_events.family_id) WHERE owner_id IS NULL;
ALTER TABLE calendar_events ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private';
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS last_edited_by uuid REFERENCES users(id);

-- 2) calendar_events.version: timestamp -> integer（乐观锁）
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns WHERE table_name='calendar_events' AND column_name='version') = 'timestamp with time zone' THEN
    ALTER TABLE calendar_events ALTER COLUMN version TYPE integer USING COALESCE(EXTRACT(EPOCH FROM version), 1)::integer;
  END IF;
END $$;

-- 3) 索引：复合 (owner_id, visibility) + version 单列（幂等）
CREATE INDEX IF NOT EXISTS tasks_zone_idx ON tasks(owner_id, visibility);
CREATE INDEX IF NOT EXISTS tasks_version_idx ON tasks(version);
CREATE INDEX IF NOT EXISTS notes_zone_idx ON notes(owner_id, visibility);
CREATE INDEX IF NOT EXISTS notes_version_idx ON notes(version);
CREATE INDEX IF NOT EXISTS reminder_clocks_zone_idx ON reminder_clocks(owner_id, visibility);
CREATE INDEX IF NOT EXISTS reminder_clocks_version_idx ON reminder_clocks(version);
CREATE INDEX IF NOT EXISTS debts_zone_idx ON debts(owner_id, visibility);
CREATE INDEX IF NOT EXISTS debts_version_idx ON debts(version);
CREATE INDEX IF NOT EXISTS incomes_zone_idx ON incomes(owner_id, visibility);
CREATE INDEX IF NOT EXISTS incomes_version_idx ON incomes(version);
CREATE INDEX IF NOT EXISTS transactions_zone_idx ON transactions(owner_id, visibility);
CREATE INDEX IF NOT EXISTS transactions_version_idx ON transactions(version);
CREATE INDEX IF NOT EXISTS assets_zone_idx ON assets(owner_id, visibility);
CREATE INDEX IF NOT EXISTS assets_version_idx ON assets(version);
CREATE INDEX IF NOT EXISTS budgets_zone_idx ON budgets(owner_id, visibility);
CREATE INDEX IF NOT EXISTS budgets_version_idx ON budgets(version);
CREATE INDEX IF NOT EXISTS interests_zone_idx ON interests(owner_id, visibility);
CREATE INDEX IF NOT EXISTS interests_version_idx ON interests(version);
CREATE INDEX IF NOT EXISTS projects_zone_idx ON projects(owner_id, visibility);
CREATE INDEX IF NOT EXISTS projects_version_idx ON projects(version);
CREATE INDEX IF NOT EXISTS domains_zone_idx ON domains(owner_id, visibility);
CREATE INDEX IF NOT EXISTS domains_version_idx ON domains(version);
CREATE INDEX IF NOT EXISTS focus_sessions_zone_idx ON focus_sessions(owner_id, visibility);
CREATE INDEX IF NOT EXISTS focus_sessions_version_idx ON focus_sessions(version);
CREATE INDEX IF NOT EXISTS finance_transfers_zone_idx ON finance_transfers(owner_id, visibility);
CREATE INDEX IF NOT EXISTS finance_transfers_version_idx ON finance_transfers(version);
CREATE INDEX IF NOT EXISTS system_meta_zone_idx ON system_meta(owner_id, visibility);
CREATE INDEX IF NOT EXISTS system_meta_version_idx ON system_meta(version);
CREATE INDEX IF NOT EXISTS calendar_events_zone_idx ON calendar_events(owner_id, visibility);
CREATE INDEX IF NOT EXISTS calendar_events_version_idx ON calendar_events(version);

-- 4) system_meta 唯一键改为 (owner_id, visibility, key)
ALTER TABLE system_meta DROP CONSTRAINT IF EXISTS system_meta_key_uniq;
ALTER TABLE system_meta DROP CONSTRAINT IF EXISTS system_meta_family_key_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS system_meta_owner_vis_key_uniq ON system_meta(owner_id, visibility, key);

-- 5) shared 快照去重（v3④）：同一 (family_id, owner_user_id, item_type, item_key) 仅保留 updated_at 最新一条
DELETE FROM shared_items a
USING shared_items b
WHERE a.family_id = b.family_id AND a.owner_user_id = b.owner_user_id AND a.item_type = b.item_type AND a.item_key = b.item_key
  AND a.updated_at < b.updated_at;

DELETE FROM shared_finance_items a
USING shared_finance_items b
WHERE a.family_id = b.family_id AND a.owner_user_id = b.owner_user_id AND a.item_type = b.item_type AND a.item_key = b.item_key
  AND a.updated_at < b.updated_at;

-- 完成。双写过渡期 family_id 列保留，应用层以 owner_id + visibility 作为 zone 读范围。
