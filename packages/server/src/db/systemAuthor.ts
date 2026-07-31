// P1（v3③）：全零 UUID 系统用户，作为 public 行在注销/迁移时兜底 owner，
// 使 owner_id → users.id 外键永不悬空。无有效登录凭证（占位 password_hash 永不匹配登录）。
import { sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

/** 全零 UUID 系统用户 ID（导出供 deleteUserAccount 与迁移引用） */
export const SYSTEM_AUTHOR_ID = '00000000-0000-0000-0000-000000000000';

export const SYSTEM_AUTHOR_EMAIL = 'system@localhost';

// 占位密码哈希：使用 bcryptjs 对任意长随机串预计算，登录比较永不相等（无对应明文）。
// 该用户不提供任何登录入口，仅作外键兜底。
const SYSTEM_AUTHOR_PASSWORD_HASH = bcrypt.hashSync(`system-placeholder-${SYSTEM_AUTHOR_ID}`, 10);

/**
 * 全零 UUID 系统家庭 ID。public 行在注销/迁移时改挂 SYSTEM_AUTHOR_ID 的同时，
 * 必须一并脱离 personal 家庭（familyId 改挂本系统家庭），否则 delete(families) 的
 * onDelete=cascade 会把仍挂在 personal 家庭下的 public 行一起级联删除（数据丢失）。
 */
export const SYSTEM_FAMILY_ID = '00000000-0000-0000-0000-000000000001';

export const SYSTEM_FAMILY_NAME = 'System';

/**
 * 幂等 upsert 系统家庭。owner 指向 SYSTEM_AUTHOR_ID（须先 ensureSystemAuthor）。
 * 注销流程在迁移 public 行前调用，保证 rehang 目标 familyId 存在，外键不悬空。
 */
export async function ensureSystemFamily(db: any): Promise<void> {
  await db.execute(sql`
    INSERT INTO families (id, name, owner_id, created_at)
    VALUES (${SYSTEM_FAMILY_ID}, ${SYSTEM_FAMILY_NAME}, ${SYSTEM_AUTHOR_ID}, now())
    ON CONFLICT (id) DO NOTHING
  `);
}

/**
 * 幂等 upsert 系统用户。在 initDb 阶段（PGLite 的 ensureSchema 或生产迁移）调用，
 * 保证 SYSTEM_AUTHOR_ID 行始终存在，public 行在注销/迁移时改挂它而不会悬空外键。
 */
export async function ensureSystemAuthor(db: any): Promise<void> {
  await db.execute(sql`
    INSERT INTO users (id, email, name, password_hash, created_at)
    VALUES (${SYSTEM_AUTHOR_ID}, ${SYSTEM_AUTHOR_EMAIL}, 'System', ${SYSTEM_AUTHOR_PASSWORD_HASH}, now())
    ON CONFLICT (id) DO NOTHING
  `);
}
