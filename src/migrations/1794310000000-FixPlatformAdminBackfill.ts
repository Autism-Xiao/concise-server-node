import { type MigrationInterface, type QueryRunner } from 'typeorm'

/**
 * 修正平台管理员的回填范围（179427 的补救）
 *
 * 179427 第一版按「持有 admin/superadmin 角色 且 角色属于默认租户」回填，
 * 结果把演示租户里挂着共享 admin 角色的账号也标成了平台管理员 —— 等于把要修的漏洞又复制了一遍。
 *
 * 本迁移：先全部清零，再按**窄口径**重标
 *  - `sys_user.username = 'admin'`（历史内置账号）
 *  - 持有 `superadmin` 角色的账号（显式约定的平台超管编码）
 * 之后新增平台管理员请走运维接口逐个授予，不要再按角色批量刷。
 *
 * 影响面：只改 sys_user.is_platform_admin 一列，不动任何业务数据。
 */
export class FixPlatformAdminBackfill1794310000000 implements MigrationInterface {
  name = 'FixPlatformAdminBackfill1794310000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    const exists: Array<{ c: number | string }> = await queryRunner.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_user' AND COLUMN_NAME = 'is_platform_admin'`
    )
    if (Number(exists[0]?.c ?? 0) === 0) return

    await queryRunner.query('UPDATE `sys_user` SET `is_platform_admin` = 0')
    await queryRunner.query(
      `UPDATE \`sys_user\` u
         LEFT JOIN \`sys_user_role\` ur ON ur.user_id = u.id
         LEFT JOIN \`sys_role\` r ON r.id = ur.role_id
          SET u.is_platform_admin = 1
        WHERE u.\`username\` = 'admin' OR r.\`role_code\` = 'superadmin'`
    )
  }

  /**
   * 不可回滚：上一版是「过宽」的，回滚回去只会把漏洞再打开一次。
   * 真要撤，请手工指定要标为平台管理员的账号。
   */
  public async down(): Promise<void> {
    // no-op
  }
}
