import { type MigrationInterface, type QueryRunner } from 'typeorm'

/**
 * 审计日志补租户维度
 *
 * 背景：sys_log 原来是全平台单表，租户 A 的审计员（system:log:*）翻得到租户 B 的
 * 登录/操作明细，params 里还可能带业务数据 —— 属于跨租户数据泄漏。
 *
 * 语义（**与其它表的 0=共享 不同，特此说明**）：
 * - `tenant_id > 0` 该操作发生在哪个租户
 * - `tenant_id = 0` 平台级操作（平台视角下做的），**只有平台管理员看得到**
 * 审计可见性不是数据共享，租户查询用 `tenant_id = ?` 严格相等，不带 OR 0。
 *
 * 回填：按操作人当前登录租户；操作人不存在（登录失败）或未选择过租户时落默认租户 1。
 */
export class AddLogTenantId1794280000000 implements MigrationInterface {
  name = 'AddLogTenantId1794280000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await this.hasColumn(queryRunner, 'sys_log', 'tenant_id'))) {
      await queryRunner.query("ALTER TABLE `sys_log` ADD COLUMN `tenant_id` INT NOT NULL DEFAULT 1 COMMENT '租户ID(0=平台级操作，仅平台管理员可见)' AFTER `id`")
    }
    // 存量回填：跟着操作人的登录租户走
    await queryRunner.query(
      `UPDATE \`sys_log\` l
         JOIN \`sys_user\` u ON u.id = l.operate_user_id
          SET l.tenant_id = COALESCE(u.login_tenant_id, 1)
        WHERE u.login_tenant_id IS NOT NULL`
    )
    if (!(await this.hasIndex(queryRunner, 'sys_log', 'idx_sys_log_tenant_type_time'))) {
      await queryRunner.query('CREATE INDEX `idx_sys_log_tenant_type_time` ON `sys_log` (`tenant_id`, `log_type`, `create_time`)')
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await this.hasIndex(queryRunner, 'sys_log', 'idx_sys_log_tenant_type_time')) {
      await queryRunner.query('ALTER TABLE `sys_log` DROP INDEX `idx_sys_log_tenant_type_time`')
    }
    if (await this.hasColumn(queryRunner, 'sys_log', 'tenant_id')) {
      await queryRunner.query('ALTER TABLE `sys_log` DROP COLUMN `tenant_id`')
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
