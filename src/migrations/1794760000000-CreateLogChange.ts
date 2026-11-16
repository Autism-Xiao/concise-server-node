import { type MigrationInterface, type QueryRunner } from 'typeorm'

/**
 * 字段级变更审计：建表 + 菜单 + 权限
 *
 * 与 sys_log 的分工写在变更表实体注释里：sys_log 记接口调用，这里记数据本身的前后值。
 * 菜单挂在「系统日志」组（menu_audit）下，权限码 `system:log:change` 独立，
 * 因为这属于"能看敏感数据变化"的能力，不该跟着普通操作日志一起放开。
 */
export class CreateLogChange1794760000000 implements MigrationInterface {
  name = 'CreateLogChange1794760000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`sys_log_change\` (
        \`id\` varchar(32) NOT NULL COMMENT '主键id',
        \`tenant_id\` int NOT NULL DEFAULT 0 COMMENT '租户ID(0=平台级操作)',
        \`table_name\` varchar(64) NOT NULL COMMENT '表名',
        \`record_id\` varchar(64) NOT NULL COMMENT '记录id',
        \`field\` varchar(64) NOT NULL COMMENT '字段名',
        \`field_label\` varchar(64) NULL COMMENT '字段中文名',
        \`old_value\` text NULL COMMENT '改前值',
        \`new_value\` text NULL COMMENT '改后值',
        \`operate_user_id\` varchar(32) NULL COMMENT '操作人id',
        \`create_time\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '变更时间',
        PRIMARY KEY (\`id\`),
        KEY \`idx_change_record\` (\`table_name\`, \`record_id\`, \`create_time\`),
        KEY \`idx_change_time\` (\`create_time\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='字段级变更审计'
    `)

    // 6 位排序号挂在操作日志（sort_no=2）之后
    await queryRunner.query(`
      INSERT IGNORE INTO \`sys_permission\` (\`id\`, \`parent_id\`, \`name\`, \`url\`, \`icon\`, \`menu_type\`, \`sort_no\`, \`status\`, \`del_flag\`, \`is_leaf\`, \`perms\`)
      VALUES ('menu_log_change', 'menu_audit', '变更审计', '/system/log/change', 'History', 1, 3, '1', 0, 1, 'system:log:change')
    `)

    // 给每个租户的 admin 补授权（admin 有 bypass，但按钮/菜单树需要这条记录才完整）
    await queryRunner.query(`
      INSERT INTO \`sys_role_permission\` (\`role_id\`, \`permission_id\`)
      SELECT r.\`id\`, 'menu_log_change' FROM \`sys_role\` r
      WHERE r.\`role_code\` = 'admin'
        AND NOT EXISTS (
          SELECT 1 FROM \`sys_role_permission\` rp WHERE rp.\`role_id\` = r.\`id\` AND rp.\`permission_id\` = 'menu_log_change'
        )
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DELETE FROM `sys_role_permission` WHERE `permission_id` = 'menu_log_change'")
    await queryRunner.query("DELETE FROM `sys_permission` WHERE `id` = 'menu_log_change'")
    await queryRunner.query('DROP TABLE IF EXISTS `sys_log_change`')
  }
}
