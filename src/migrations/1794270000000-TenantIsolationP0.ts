import { type MigrationInterface, type QueryRunner } from 'typeorm'

/**
 * 多租户隔离 P0：身份分层 + 角色唯一键按租户
 *
 * 解决两个「绕过隔离」的根因：
 *
 * 1. `isSuper` 原来按 `role_code in ('admin','superadmin')` 判定，而 sys_role 是**租户级**表
 *    → 被授予 admin 角色的租户用户等同于平台超管：可以随意指定 X-Tenant-Id 读任意租户，
 *    不带请求头时 tenantId=null 更是直接全表不过滤。
 *    改为显式标志位 `sys_user.is_platform_admin`，只有平台运营账号为 1。
 *
 * 2. `sys_role.role_code` 原来是**全局唯一** → 租户 B 无法创建自己的 admin 编码，
 *    软删角色还会一直占着唯一键。改为 `(tenant_id, role_code)` 联合唯一，
 *    并用 `is_builtin` 标记内置角色（替代按编码判断，防止租户自建同名编码被误当内置）。
 *
 * 回填口径（**故意很窄**）：只有历史内置账号 `admin` 与持有 `superadmin` 角色的账号算平台管理员。
 *
 * 为什么不能按「持有 admin/superadmin 角色」批量回填：admin 角色是**共享**的那一条
 * （tenant_id=1），演示租户的用户也挂着它，按角色回填会把一堆租户用户一次性提升成平台超管 ——
 * 正是本次要修的问题本身。更多平台管理员请用后续接口逐个授予。
 */
export class TenantIsolationP01794270000000 implements MigrationInterface {
  name = 'TenantIsolationP01794270000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---------- sys_user.is_platform_admin ----------
    if (!(await this.hasColumn(queryRunner, 'sys_user', 'is_platform_admin'))) {
      await queryRunner.query(
        "ALTER TABLE `sys_user` ADD COLUMN `is_platform_admin` TINYINT NOT NULL DEFAULT 0 COMMENT '是否平台管理员(1是 0否)' AFTER `del_flag`"
      )
    }
    await queryRunner.query(
      `UPDATE \`sys_user\` u
         LEFT JOIN \`sys_user_role\` ur ON ur.user_id = u.id
         LEFT JOIN \`sys_role\` r ON r.id = ur.role_id
          SET u.is_platform_admin = 1
        WHERE u.\`username\` = 'admin' OR r.\`role_code\` = 'superadmin'`
    )

    // ---------- sys_role.is_builtin ----------
    if (!(await this.hasColumn(queryRunner, 'sys_role', 'is_builtin'))) {
      await queryRunner.query(
        "ALTER TABLE `sys_role` ADD COLUMN `is_builtin` TINYINT NOT NULL DEFAULT 0 COMMENT '是否内置角色(1是 0否) 内置角色不可删除/停用/授权' AFTER `tenant_id`"
      )
    }
    await queryRunner.query("UPDATE `sys_role` SET `is_builtin` = 1 WHERE `role_code` IN ('admin', 'superadmin') AND `tenant_id` IN (0, 1)")

    // ---------- 唯一键：role_code → (tenant_id, role_code) ----------
    if (await this.hasIndex(queryRunner, 'sys_role', 'uniq_sys_role_role_code')) {
      await queryRunner.query('ALTER TABLE `sys_role` DROP INDEX `uniq_sys_role_role_code`')
    }
    if (!(await this.hasIndex(queryRunner, 'sys_role', 'uniq_sys_role_tenant_code'))) {
      await queryRunner.query('ALTER TABLE `sys_role` ADD UNIQUE KEY `uniq_sys_role_tenant_code` (`tenant_id`, `role_code`)')
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await this.hasIndex(queryRunner, 'sys_role', 'uniq_sys_role_tenant_code')) {
      await queryRunner.query('ALTER TABLE `sys_role` DROP INDEX `uniq_sys_role_tenant_code`')
    }
    if (!(await this.hasIndex(queryRunner, 'sys_role', 'uniq_sys_role_role_code'))) {
      await queryRunner.query('ALTER TABLE `sys_role` ADD UNIQUE KEY `uniq_sys_role_role_code` (`role_code`)')
    }
    if (await this.hasColumn(queryRunner, 'sys_role', 'is_builtin')) {
      await queryRunner.query('ALTER TABLE `sys_role` DROP COLUMN `is_builtin`')
    }
    if (await this.hasColumn(queryRunner, 'sys_user', 'is_platform_admin')) {
      await queryRunner.query('ALTER TABLE `sys_user` DROP COLUMN `is_platform_admin`')
    }
  }

  private async hasColumn(queryRunner: QueryRunner, table: string, column: string): Promise<boolean> {
    const rows: Array<{ c: number | string }> = await queryRunner.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column]
    )
    return Number(rows[0]?.c ?? 0) > 0
  }

  private async hasIndex(queryRunner: QueryRunner, table: string, index: string): Promise<boolean> {
    const rows: Array<{ c: number | string }> = await queryRunner.query(
      `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
      [table, index]
    )
    return Number(rows[0]?.c ?? 0) > 0
  }
}
