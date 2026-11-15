import { type MigrationInterface, type QueryRunner } from 'typeorm'

/** 生成器产物：订单表（biz_order）+ 菜单节点（租户级，挂 menu_collab 下） */
export class GenBizOrder1794744585590 implements MigrationInterface {
  name = 'GenBizOrder1794744585590'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`biz_order\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`tenant_id\` int NOT NULL DEFAULT 1 COMMENT '租户ID(0=平台共享)',
        \`title\` VARCHAR(128) NOT NULL COMMENT '标题',
        \`status\` TINYINT NULL DEFAULT '1' COMMENT '状态(1:启用 0:停用)',
        \`amount\` DECIMAL(14,2) NULL DEFAULT NULL COMMENT '金额',
        \`signed_at\` DATETIME NULL DEFAULT NULL COMMENT '签约时间',
        \`remark\` TEXT NULL DEFAULT NULL COMMENT '备注',
        \`create_by\` varchar(32) NULL COMMENT '创建人',
        \`update_by\` varchar(32) NULL COMMENT '更新人',
        \`del_flag\` tinyint NOT NULL DEFAULT 0 COMMENT '0正常 1已删除',
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        KEY \`idx_biz_order_tenant\` (\`tenant_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='订单'
    `)
    await queryRunner.query(`
      INSERT IGNORE INTO \`sys_permission\`
        (\`id\`, \`parent_id\`, \`name\`, \`url\`, \`component\`, \`is_route\`, \`menu_type\`, \`perms\`, \`perms_type\`, \`sort_no\`, \`icon\`, \`is_leaf\`, \`hidden\`, \`del_flag\`, \`rule_flag\`, \`status\`, \`scope\`)
      VALUES
        ('menu_biz_order', 'menu_collab', '订单管理', '/system/biz_orders', NULL, 1, 1, 'biz_order:list', '0', 50, 'Briefcase', 0, 0, 0, 1, '1', 'tenant'),
        ('menu_biz_order_add', 'menu_biz_order', '新增订单', NULL, NULL, 1, 2, 'biz_order:add', '0', 1, NULL, 1, 0, 0, 1, '1', 'tenant'),
        ('menu_biz_order_edit', 'menu_biz_order', '编辑订单', NULL, NULL, 1, 2, 'biz_order:update', '0', 2, NULL, 1, 0, 0, 1, '1', 'tenant'),
        ('menu_biz_order_del', 'menu_biz_order', '删除订单', NULL, NULL, 1, 2, 'biz_order:delete', '0', 3, NULL, 1, 0, 0, 1, '1', 'tenant')
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DELETE FROM `sys_role_permission` WHERE `permission_id` IN (SELECT `id` FROM (SELECT `id` FROM `sys_permission` WHERE `id` LIKE 'menu_biz_order%') t)"
    )
    await queryRunner.query("DELETE FROM `sys_permission` WHERE `id` LIKE 'menu_biz_order%'")
    await queryRunner.query(`DROP TABLE IF EXISTS \`biz_order\``)
  }
}
