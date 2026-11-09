import { type MigrationInterface, type QueryRunner } from 'typeorm'

/**
 * 补「任务管理」菜单与按钮权限
 *
 * 背景：task 表早已存在、后端 service 也完整（状态机、过滤、租户隔离），
 * 但一直缺三样东西，导致功能等于不存在：
 * 1. 没有 v1 控制器（旧 `@Controller('tasks')` 受 LEGACY_ROUTES_ENABLED 控制，默认不注册）
 * 2. sys_permission 里没有任务菜单与按钮节点 —— 角色权限页无从勾选，前端也没有入口
 * 3. 前端没有任务页面，首页 dashboard 返回的 myTasks 块没人消费
 *
 * 本迁移只解决第 2 点；接口与页面在同一次提交里补齐。
 *
 * 归属：「协同办公」组（menu_collab，sort_no 5，排在通知公告/日历/消息/供应商之后）。
 * 授权：admin 全授；editor（编辑者）授 list/add/update —— 能建能改但删不了。
 *       viewer/auditor 不授，需要时由管理员在角色权限页勾选。
 */
const MENU_ID = 'menu_task'
const PARENT_ID = 'menu_collab'
const SORT_NO = 5

/** [id, name, perms, sortNo, 授给哪些角色] */
const BUTTONS: Array<[string, string, string, number, string[]]> = [
  ['menu_task_add', '新增任务', 'system:task:add', 1, ['admin', 'editor']],
  ['menu_task_update', '修改任务', 'system:task:update', 2, ['admin', 'editor']],
  ['menu_task_delete', '删除任务', 'system:task:delete', 3, ['admin']]
]

/** 菜单节点本身也要授权（否则角色能看到接口权限却看不到页面） */
const MENU_ROLES = ['admin', 'editor']

export class AddTaskMenu1794240000000 implements MigrationInterface {
  name = 'AddTaskMenu1794240000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. 页面菜单（menu_type=1 表示菜单，is_route=1 参与路由）
    await queryRunner.query(
      `INSERT IGNORE INTO \`sys_permission\`
       (\`id\`, \`parent_id\`, \`name\`, \`url\`, \`component\`, \`is_route\`, \`menu_type\`, \`perms\`, \`perms_type\`, \`sort_no\`, \`icon\`, \`is_leaf\`, \`hidden\`, \`del_flag\`, \`rule_flag\`, \`status\`, \`create_time\`)
       VALUES (?, ?, '任务管理', '/system/task', 'system/task/index', 1, 1, 'system:task:list', '1', ?, 'ListTodo', 0, 0, 0, 0, '1', NOW())`,
      [MENU_ID, PARENT_ID, SORT_NO]
    )

    // 2. 按钮权限节点（menu_type=2，不参与路由）
    for (const [id, name, perms, sortNo] of BUTTONS) {
      await queryRunner.query(
        `INSERT IGNORE INTO \`sys_permission\`
         (\`id\`, \`parent_id\`, \`name\`, \`perms\`, \`menu_type\`, \`perms_type\`, \`sort_no\`, \`is_route\`, \`is_leaf\`, \`hidden\`, \`del_flag\`, \`rule_flag\`, \`status\`, \`create_time\`)
         VALUES (?, ?, ?, ?, 2, '1', ?, 1, 1, 0, 0, 0, '1', NOW())`,
        [id, MENU_ID, name, perms, sortNo]
      )
    }

    // 3. 角色授权（NOT EXISTS 保证可重复执行）
    const grants: Array<[string, string[]]> = [[MENU_ID, MENU_ROLES], ...BUTTONS.map(([id, , , , roles]): [string, string[]] => [id, roles])]
    for (const [permissionId, roles] of grants) {
      for (const roleCode of roles) {
        await queryRunner.query(
          "INSERT INTO `sys_role_permission` (`id`, `role_id`, `permission_id`) SELECT REPLACE(UUID(), '-', ''), r.`id`, ? FROM `sys_role` r WHERE r.`role_code` = ? AND NOT EXISTS (SELECT 1 FROM `sys_role_permission` rp WHERE rp.`role_id` = r.`id` AND rp.`permission_id` = ?)",
          [permissionId, roleCode, permissionId]
        )
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const ids = [MENU_ID, ...BUTTONS.map(([id]) => id)]
    const placeholders = ids.map(() => '?').join(', ')
    await queryRunner.query(`DELETE FROM \`sys_role_permission\` WHERE \`permission_id\` IN (${placeholders})`, ids)
    await queryRunner.query(`DELETE FROM \`sys_permission\` WHERE \`id\` IN (${placeholders})`, ids)
  }
}
