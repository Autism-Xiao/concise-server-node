import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 多租户治理补强：
 *
 * 1. `sys_user.is_tenant_admin` —— 租户管理员兜底标志位
 *    与 is_platform_admin（平台层账号属性）不同，这个字段是“派生状态”：
 *    只要用户在至少一个租户里绑定了 role_code='admin' 的角色，就置 1。
 *    用途：① 租户最后一个管理员被误移除时的兜底识别；② 前端/接口快速标注；
 *    ③ 权限校验不必每次联表查角色（鉴权仍以真实角色为准，标志位不是放宽口子）。
 *    写入侧在 UserService.assignRoles / TenantService.applyCreate / assignUsers 同步维护。
 *
 * 2. 三个租户维度复合索引
 *    - sys_webhook：列表按 (tenant_id, del_flag, create_time) 排序分页
 *    - sys_file：文件列表按 (tenant_id, owner_id, is_deleted, parent_id) 查同目录
 *    - sys_announcement：公告列表按 (tenant_id, del_flag, send_status) 过滤
 *
 * 回滚：删索引、删列。
 */
export class TenantAdminFlagAndIndexes1794950000000 implements MigrationInterface {
  name = 'TenantAdminFlagAndIndexes1794950000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- 1. 标志位列 ----
    const column = (await queryRunner.query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_user' AND COLUMN_NAME = 'is_tenant_admin'"
    )) as unknown[]
    if (column.length === 0) {
      await queryRunner.query("ALTER TABLE `sys_user` ADD COLUMN `is_tenant_admin` tinyint NOT NULL DEFAULT 0 COMMENT '是否租户管理员(1是 0否)'")
      await queryRunner.query(`
        UPDATE \`sys_user\` u SET \`is_tenant_admin\` = 1
         WHERE EXISTS (
           SELECT 1 FROM \`sys_user_role\` ur
             JOIN \`sys_role\` r ON r.id = ur.role_id
             JOIN \`sys_user_tenant\` ut ON ut.user_id = ur.user_id AND ut.tenant_id = r.tenant_id AND ut.status = 0
            WHERE ur.user_id = u.id AND r.role_code = 'admin' AND r.tenant_id > 0
         )
      `)
    }

    // ---- 2. 复合索引（MySQL 不支持 ADD INDEX IF NOT EXISTS，先查 information_schema）----
    await this.addIndexIfMissing(queryRunner, 'sys_webhook', 'idx_webhook_tenant_del_time', '`tenant_id`, `del_flag`, `create_time`')
    await this.addIndexIfMissing(queryRunner, 'sys_file', 'idx_sys_file_tenant_owner_deleted', '`tenant_id`, `owner_id`, `is_deleted`, `parent_id`')
    await this.addIndexIfMissing(queryRunner, 'sys_announcement', 'idx_announce_tenant_del_send', '`tenant_id`, `del_flag`, `send_status`')
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.dropIndexIfExists(queryRunner, 'sys_webhook', 'idx_webhook_tenant_del_time')
    await this.dropIndexIfExists(queryRunner, 'sys_file', 'idx_sys_file_tenant_owner_deleted')
    await this.dropIndexIfExists(queryRunner, 'sys_announcement', 'idx_announce_tenant_del_send')
    await queryRunner.query('ALTER TABLE `sys_user` DROP COLUMN `is_tenant_admin`')
  }

  private async addIndexIfMissing(queryRunner: QueryRunner, table: string, name: string, columns: string): Promise<void> {
    const rows = (await queryRunner.query(
      'SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?',
      [table, name]
    )) as unknown[]
    if (rows.length === 0) {
      await queryRunner.query(`ALTER TABLE \`${table}\` ADD INDEX \`${name}\` (${columns})`)
    }
  }

  private async dropIndexIfExists(queryRunner: QueryRunner, table: string, name: string): Promise<void> {
    const rows = (await queryRunner.query(
      'SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?',
      [table, name]
    )) as unknown[]
    if (rows.length > 0) {
      await queryRunner.query(`ALTER TABLE \`${table}\` DROP INDEX \`${name}\``)
    }
  }
}
