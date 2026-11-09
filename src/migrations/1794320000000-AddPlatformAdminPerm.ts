import { type MigrationInterface, type QueryRunner } from 'typeorm'

/**
 * 补「平台管理员」按钮权限点
 *
 * 背景：`sys_user.is_platform_admin` 已经落地为平台 / 租户的唯一分界，但一直没有接口能改它，
 * 只能手工改库。本迁移补上权限点，配套的 `PUT /v1/users/:id/platform-admin` 在同一次提交里。
 *
 * 关键：`scope = 'platform'`
 * - PermsGuard 对 platform 作用域的权限点，除「持有该权限」外还要求 `is_platform_admin = 1`
 *   → 租户管理员即便把自己的角色勾上这个按钮，也调不动（不会再出现「权限被授出去就提权」）
 * - 租户用户的导航树与角色授权页都会过滤 platform 节点 → 这个按钮只在平台管理员眼里出现
 *
 * 授权范围：只授给默认租户(1) 的内置 admin / superadmin 角色。其他租户的 admin 是租户管理员，
 * 不该拥有授予平台管理员的能力。
 */
const PERM_ID = 'menu_user_platform'
const PARENT_ID = 'menu_2'
const PERM_CODE = 'system:user:platform'
const SORT_NO = 8

export class AddPlatformAdminPerm1794320000000 implements MigrationInterface {
  name = 'AddPlatformAdminPerm1794320000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT IGNORE INTO \`sys_permission\`
       (\`id\`, \`parent_id\`, \`name\`, \`perms\`, \`scope\`, \`menu_type\`, \`perms_type\`, \`sort_no\`, \`is_route\`, \`is_leaf\`, \`hidden\`, \`del_flag\`, \`rule_flag\`, \`status\`, \`create_time\`)
       VALUES (?, ?, '平台管理员', ?, 'platform', 2, '1', ?, 1, 1, 0, 0, 0, '1', NOW())`,
      [PERM_ID, PARENT_ID, PERM_CODE, SORT_NO]
    )

    // 只授平台内置角色（tenant_id = 1），租户内的同名 admin 角色不受影响
    await queryRunner.query(
      `INSERT INTO \`sys_role_permission\` (\`id\`, \`role_id\`, \`permission_id\`)
       SELECT REPLACE(UUID(), '-', ''), r.\`id\`, ?
         FROM \`sys_role\` r
        WHERE r.\`role_code\` IN ('admin', 'superadmin') AND r.\`tenant_id\` = 1
          AND NOT EXISTS (SELECT 1 FROM \`sys_role_permission\` rp WHERE rp.\`role_id\` = r.\`id\` AND rp.\`permission_id\` = ?)`,
      [PERM_ID, PERM_ID]
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DELETE FROM `sys_role_permission` WHERE `permission_id` = ?', [PERM_ID])
    await queryRunner.query('DELETE FROM `sys_permission` WHERE `id` = ?', [PERM_ID])
  }
}
