import { type MigrationInterface, type QueryRunner } from 'typeorm'

/**
 * 清理旧「附件体系」的 3 个权限节点：tools:upload / tools:storage:list / tools:storage:delete
 *
 * 背景：旧 /api/upload、/api/storage 控制器原本不受 LEGACY_ROUTES_ENABLED 控制、无条件注册，
 * 权限节点删了会让旧接口无人可授权，因此一直保留，代价是角色权限树里「文件上传」出现两次。
 * 本次：新增 `/v1/upload`（权限码对齐 `system:file:upload`），旧控制器纳入 LEGACY_ROUTES_ENABLED
 * 开关（默认关闭），三个 tools:* 节点失去守护对象，随之删除。
 */
export class RemoveLegacyToolPerms1794200000000 implements MigrationInterface {
  name = 'RemoveLegacyToolPerms1794200000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 派生表包一层：MySQL 不允许 DELETE 的目标表与子查询同表
    await queryRunner.query(
      "DELETE FROM `sys_role_permission` WHERE `permission_id` IN (SELECT `id` FROM (SELECT `id` FROM `sys_permission` WHERE `perms` IN ('tools:upload','tools:storage:list','tools:storage:delete')) t)"
    )
    await queryRunner.query("DELETE FROM `sys_permission` WHERE `perms` IN ('tools:upload','tools:storage:list','tools:storage:delete')")
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 节点可恢复（挂回文件管理目录，找不到就挂顶层）；角色授权属运行期数据，不回滚
    await queryRunner.query(
      `INSERT IGNORE INTO \`sys_permission\` (\`id\`, \`parent_id\`, \`name\`, \`perms\`, \`menu_type\`, \`sort_no\`, \`status\`, \`del_flag\`, \`is_leaf\`)
       SELECT 'menu_32', COALESCE((SELECT p2.\`id\` FROM \`sys_permission\` p2 WHERE p2.\`url\` = '/system/file' LIMIT 1), 'menu_1'),
              '文件上传', 'tools:upload', 2, 1, '1', 0, 1
       FROM DUAL`
    )
    await queryRunner.query(
      `INSERT IGNORE INTO \`sys_permission\` (\`id\`, \`parent_id\`, \`name\`, \`perms\`, \`menu_type\`, \`sort_no\`, \`status\`, \`del_flag\`, \`is_leaf\`)
       SELECT 'menu_33', COALESCE((SELECT p2.\`id\` FROM \`sys_permission\` p2 WHERE p2.\`url\` = '/system/file' LIMIT 1), 'menu_1'),
              '存储查询', 'tools:storage:list', 2, 2, '1', 0, 1
       FROM DUAL`
    )
    await queryRunner.query(
      `INSERT IGNORE INTO \`sys_permission\` (\`id\`, \`parent_id\`, \`name\`, \`perms\`, \`menu_type\`, \`sort_no\`, \`status\`, \`del_flag\`, \`is_leaf\`)
       SELECT 'menu_34', COALESCE((SELECT p2.\`id\` FROM \`sys_permission\` p2 WHERE p2.\`url\` = '/system/file' LIMIT 1), 'menu_1'),
              '存储删除', 'tools:storage:delete', 2, 3, '1', 0, 1
       FROM DUAL`
    )
  }
}
