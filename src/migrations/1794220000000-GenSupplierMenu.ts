import { type MigrationInterface, type QueryRunner } from 'typeorm'

/**
 * 代码生成器 demo（供应商模块）补菜单节点
 *
 * 生成器只产出代码（entity/service/controller + 前端页面），菜单要进 sys_permission
 * 才会在动态侧边栏出现。参照 CreateSysMessage 的做法补录：
 * 「供应商管理」挂协同办公下第 4 项，按钮 3 个（新增/编辑/删除）。
 * 角色可见性照旧走菜单管理/角色授权自助配置（超管默认全可见）。
 */
export class GenSupplierMenu1794220000000 implements MigrationInterface {
  name = 'GenSupplierMenu1794220000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT IGNORE INTO \`sys_permission\` (\`id\`, \`parent_id\`, \`name\`, \`url\`, \`icon\`, \`menu_type\`, \`sort_no\`, \`status\`, \`del_flag\`, \`is_leaf\`, \`perms\`)
      VALUES
        ('menu_supplier', 'menu_collab', '供应商管理', '/system/suppliers', 'Briefcase', 1, 4, '1', 0, 0, 'supplier:list'),
        ('menu_supplier_add', 'menu_supplier', '新增供应商', NULL, NULL, 2, 1, '1', 0, 1, 'supplier:add'),
        ('menu_supplier_edit', 'menu_supplier', '编辑供应商', NULL, NULL, 2, 2, '1', 0, 1, 'supplier:update'),
        ('menu_supplier_del', 'menu_supplier', '删除供应商', NULL, NULL, 2, 3, '1', 0, 1, 'supplier:delete')
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DELETE FROM `sys_role_permission` WHERE `permission_id` IN (SELECT `id` FROM (SELECT `id` FROM `sys_permission` WHERE `id` IN ('menu_supplier','menu_supplier_add','menu_supplier_edit','menu_supplier_del')) t)"
    )
    await queryRunner.query("DELETE FROM `sys_permission` WHERE `id` IN ('menu_supplier','menu_supplier_add','menu_supplier_edit','menu_supplier_del')")
  }
}
