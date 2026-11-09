import { type MigrationInterface, type QueryRunner } from 'typeorm'

/**
 * 权限作用域分层：platform（平台级）/ tenant（租户级）
 *
 * 背景：@Perms('system:tenant:add') 这类权限来自角色，而角色由租户管理员自己编辑
 * → 租户管理员可以给自己授「创建/删除租户」，越权到平台层。
 *
 * 新语义：`sys_permission.scope = 'platform'` 的权限点，除持有权限外还要求
 * `sys_user.is_platform_admin = 1`；同时这类菜单不会出现在租户用户的导航里。
 *
 * 判定为平台级的三类：
 * 1. 租户管理 / 菜单管理 —— 改的是全平台唯一的东西
 * 2. 运维管理（定时任务 / 在线用户 / 服务监控 / 缓存监控）—— 进程级资源，不属任何租户
 * 3. 存储配置（tools:storage:*）—— 平台基础设施
 *
 * 用户 / 角色 / 部门 / 公告 / 任务 / 日志等保持 tenant：租户管理员应当能管自己租户的。
 */
export class PermissionScope1794300000000 implements MigrationInterface {
  name = 'PermissionScope1794300000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    const exists: Array<{ c: number | string }> = await queryRunner.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_permission' AND COLUMN_NAME = 'scope'`
    )
    if (Number(exists[0]?.c ?? 0) === 0) {
      await queryRunner.query(
        "ALTER TABLE `sys_permission` ADD COLUMN `scope` VARCHAR(16) NOT NULL DEFAULT 'tenant' COMMENT '作用域(platform平台级 tenant租户级)' AFTER `perms`"
      )
    }

    await queryRunner.query(
      `UPDATE \`sys_permission\`
          SET \`scope\` = 'platform'
        WHERE \`perms\` REGEXP '^(system:(tenant|menu|job|online|monitor):|tools:storage:)'
           OR \`url\` IN ('/system/tenant', '/system/menu', '/ops')
           OR \`url\` LIKE '/ops/%'`
    )

    if (!(await this.hasIndex(queryRunner, 'sys_permission', 'idx_sys_permission_scope'))) {
      await queryRunner.query('CREATE INDEX `idx_sys_permission_scope` ON `sys_permission` (`scope`, `del_flag`)')
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await this.hasIndex(queryRunner, 'sys_permission', 'idx_sys_permission_scope')) {
      await queryRunner.query('ALTER TABLE `sys_permission` DROP INDEX `idx_sys_permission_scope`')
    }
    const exists = await queryRunner.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_permission' AND COLUMN_NAME = 'scope'`
    )
    if (Number(exists[0]?.c ?? 0) > 0) {
      await queryRunner.query('ALTER TABLE `sys_permission` DROP COLUMN `scope`')
    }
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
