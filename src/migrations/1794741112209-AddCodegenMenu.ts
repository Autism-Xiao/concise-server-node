import { type MigrationInterface, type QueryRunner } from 'typeorm'

/**
 * 代码生成器菜单节点（平台级）
 *
 * 归属：「系统管理」下，排序 90（排在菜单管理之后）。
 * 作用域 platform：会写后端仓库源码，只有平台管理员能看到/进入；
 * 生产环境接口另由 CODEGEN_ENABLED 开关兜底（默认关闭）。
 */
export class AddCodegenMenu1794741112209 implements MigrationInterface {
  name = 'AddCodegenMenu1794741112209'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT IGNORE INTO \`sys_permission\`
        (\`id\`, \`parent_id\`, \`name\`, \`url\`, \`component\`, \`is_route\`, \`menu_type\`, \`perms\`, \`perms_type\`, \`sort_no\`, \`icon\`,
         \`is_leaf\`, \`hidden\`, \`del_flag\`, \`rule_flag\`, \`status\`, \`scope\`)
      VALUES
        ('menu_codegen', 'menu_1', '代码生成', '/system/codegen', NULL, 1, 1, 'tools:codegen:list', '0', 90, 'Wrench', 0, 0, 0, 1, '1', 'platform'),
        ('menu_codegen_generate', 'menu_codegen', '执行生成', NULL, NULL, 1, 2, 'tools:codegen:generate', '0', 1, NULL, 1, 0, 0, 1, '1', 'platform')
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DELETE FROM `sys_role_permission` WHERE `permission_id` IN ('menu_codegen', 'menu_codegen_generate')")
    await queryRunner.query("DELETE FROM `sys_permission` WHERE `id` IN ('menu_codegen', 'menu_codegen_generate')")
  }
}
