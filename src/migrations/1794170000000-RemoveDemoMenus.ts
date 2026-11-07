import { type MigrationInterface, type QueryRunner } from 'typeorm'

/**
 * 下掉三个演示菜单：任务（/tasks）、应用（/apps）、聊天（/chats）
 *
 * 背景：这三项是早期脚手架留下的演示页（任务页读的是 public/mock/tasks.json，
 * 应用页是硬编码的第三方应用列表，聊天页是三条假会话），前端页面、路由、i18n
 * 已经一并删除。菜单是后端 sys_permission 下发的，只删前端会出现「侧边栏还在、
 * 点进去 404」，所以这里把菜单节点和角色授权一起清掉。
 *
 * 连带删除「任务」下的三个按钮权限（system:task:add/update/delete）：
 * 父菜单没了，按钮节点留着只会让角色权限树出现孤儿节点。
 *
 * 注意：这里删的是**菜单**，不是后端 modules/task 的任务接口与 base_task 表 ——
 * 首页概览的「我的待办」统计仍走那套接口，属于另一件事，别顺手删。
 */
const DEMO_MENU_IDS = ['menu_27', 'menu_28', 'menu_29', 'menu_30', 'menu_36', 'menu_37']

/** down 回滚用的原始节点（取自迁移执行前的库内真实值） */
interface DemoMenuRow {
  id: string
  parentId: string | null
  name: string
  url: string | null
  component: string | null
  menuType: number
  perms: string | null
  sortNo: number
  icon: string | null
  isLeaf: number
}

const DEMO_MENUS: DemoMenuRow[] = [
  {
    id: 'menu_27',
    parentId: null,
    name: '任务',
    url: '/tasks',
    component: 'system/task/index',
    menuType: 0,
    perms: 'system:task:list',
    sortNo: 2,
    icon: 'ListTodo',
    isLeaf: 0
  },
  { id: 'menu_28', parentId: 'menu_27', name: '任务新增', url: null, component: null, menuType: 2, perms: 'system:task:add', sortNo: 1, icon: null, isLeaf: 1 },
  {
    id: 'menu_29',
    parentId: 'menu_27',
    name: '任务修改',
    url: null,
    component: null,
    menuType: 2,
    perms: 'system:task:update',
    sortNo: 2,
    icon: null,
    isLeaf: 1
  },
  {
    id: 'menu_30',
    parentId: 'menu_27',
    name: '任务删除',
    url: null,
    component: null,
    menuType: 2,
    perms: 'system:task:delete',
    sortNo: 3,
    icon: null,
    isLeaf: 1
  },
  { id: 'menu_36', parentId: null, name: '应用', url: '/apps', component: null, menuType: 0, perms: null, sortNo: 3, icon: 'AppWindow', isLeaf: 1 },
  { id: 'menu_37', parentId: null, name: '聊天', url: '/chats', component: null, menuType: 0, perms: null, sortNo: 4, icon: 'MessagesSquare', isLeaf: 1 }
]

export class RemoveDemoMenus1794170000000 implements MigrationInterface {
  name = 'RemoveDemoMenus1794170000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    const placeholders = DEMO_MENU_IDS.map(() => '?').join(', ')
    // 授权先删：sys_role_permission 还引用着这些菜单 id，菜单删了关联留着就是脏数据
    await queryRunner.query(`DELETE FROM \`sys_role_permission\` WHERE \`permission_id\` IN (${placeholders})`, DEMO_MENU_IDS)
    await queryRunner.query(`DELETE FROM \`sys_permission\` WHERE \`id\` IN (${placeholders})`, DEMO_MENU_IDS)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 只恢复菜单节点本身；角色授权属于运行期数据（谁被授过权取决于当时的分配），迁移不回滚，
    // 回滚后需要管理员在「角色权限」里重新勾选
    for (const row of DEMO_MENUS) {
      await queryRunner.query(
        'INSERT IGNORE INTO `sys_permission` (`id`, `parent_id`, `name`, `url`, `component`, `is_route`, `menu_type`, `perms`, `perms_type`, `sort_no`, `icon`, `is_leaf`, `hidden`, `del_flag`, `rule_flag`, `status`) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?)',
        [row.id, row.parentId, row.name, row.url, row.component, row.menuType, row.perms, '1', row.sortNo, row.icon, row.isLeaf, '1']
      )
    }
  }
}
