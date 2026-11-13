import { type MigrationInterface, type QueryRunner } from 'typeorm'

/** 生成器产物：客户表（customer）+ 菜单节点（租户级，挂 menu_collab 下） */
export class GenCustomer1794593401445 implements MigrationInterface {
  name = 'GenCustomer1794593401445'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`customer\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`tenant_id\` int NOT NULL DEFAULT 1 COMMENT '租户ID(0=平台共享)',
        \`name\` VARCHAR(128) NOT NULL COMMENT '客户名称',
        \`contact\` VARCHAR(128) NULL DEFAULT NULL COMMENT '联系人',
        \`phone\` VARCHAR(128) NULL DEFAULT NULL COMMENT '电话',
        \`level\` TINYINT NULL DEFAULT '1' COMMENT '级别',
        \`vip\` TINYINT NULL DEFAULT NULL COMMENT '客户等级(0:普通 1:VIP)',
        \`remark\` TEXT NULL DEFAULT NULL COMMENT '备注',
        \`create_by\` varchar(32) NULL COMMENT '创建人',
        \`update_by\` varchar(32) NULL COMMENT '更新人',
        \`del_flag\` tinyint NOT NULL DEFAULT 0 COMMENT '0正常 1已删除',
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        KEY \`idx_customer_tenant\` (\`tenant_id\`), UNIQUE KEY \`uniq_customer_phone\` (\`tenant_id\`, \`phone\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='客户'
    `)
    await queryRunner.query(`
      INSERT IGNORE INTO \`sys_permission\`
        (\`id\`, \`parent_id\`, \`name\`, \`url\`, \`component\`, \`is_route\`, \`menu_type\`, \`perms\`, \`perms_type\`, \`sort_no\`, \`icon\`, \`is_leaf\`, \`hidden\`, \`del_flag\`, \`rule_flag\`, \`status\`, \`scope\`)
      VALUES
        ('menu_customer', 'menu_collab', '客户管理', '/system/customers', NULL, 1, 1, 'customer:list', '0', 50, 'Briefcase', 0, 0, 0, 1, '1', 'tenant'),
        ('menu_customer_add', 'menu_customer', '新增客户', NULL, NULL, 1, 2, 'customer:add', '0', 1, NULL, 1, 0, 0, 1, '1', 'tenant'),
        ('menu_customer_edit', 'menu_customer', '编辑客户', NULL, NULL, 1, 2, 'customer:update', '0', 2, NULL, 1, 0, 0, 1, '1', 'tenant'),
        ('menu_customer_del', 'menu_customer', '删除客户', NULL, NULL, 1, 2, 'customer:delete', '0', 3, NULL, 1, 0, 0, 1, '1', 'tenant')
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DELETE FROM `sys_role_permission` WHERE `permission_id` IN (SELECT `id` FROM (SELECT `id` FROM `sys_permission` WHERE `id` LIKE 'menu_customer%') t)"
    )
    await queryRunner.query("DELETE FROM `sys_permission` WHERE `id` LIKE 'menu_customer%'")
    await queryRunner.query(`DROP TABLE IF EXISTS \`customer\``)
  }
}
