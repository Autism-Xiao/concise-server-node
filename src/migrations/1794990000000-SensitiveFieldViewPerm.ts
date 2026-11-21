import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 字段级查看权限点：data:sensitive:view
 *
 * 挂协作父菜单下，不出现在侧边栏（hidden=1），只用于角色授权。
 * 租户模板里 admin/editor 档会拿到（后缀 view 不在 DANGEROUS_SUFFIXES），
 * viewer/read 档拿不到（READ_SUFFIXES 不含 view）—— SensitiveInterceptor 据此决定
 * 是否返回 customer.phone / biz_order.amount 原文。
 *
 * 存量租户需跑一次 POST /v1/tenants/provision-all 才会把新权限点补进模板角色。
 */
export class SensitiveFieldViewPerm1794990000000 implements MigrationInterface {
  name = 'SensitiveFieldViewPerm1794990000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT IGNORE INTO \`sys_permission\`
        (\`id\`, \`parent_id\`, \`name\`, \`url\`, \`component\`, \`is_route\`, \`menu_type\`, \`perms\`, \`perms_type\`, \`sort_no\`, \`icon\`, \`is_leaf\`, \`hidden\`, \`del_flag\`, \`rule_flag\`, \`status\`, \`scope\`)
       VALUES ('perm_sensitive_view', 'menu_collab', '敏感字段查看', NULL, NULL, 1, 2, 'data:sensitive:view', '0', 99, NULL, 1, 1, 0, 1, '1', 'tenant')`
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DELETE FROM `sys_role_permission` WHERE `permission_id` = 'perm_sensitive_view'")
    await queryRunner.query("DELETE FROM `sys_permission` WHERE `id` = 'perm_sensitive_view'")
  }
}
