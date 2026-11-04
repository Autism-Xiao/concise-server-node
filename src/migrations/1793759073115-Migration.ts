import { type MigrationInterface, type QueryRunner } from 'typeorm'

interface SeedButton {
  name: string
  permission: string
}

interface SeedMenu {
  name: string
  path: string
  component: string
  icon: string
  sort: number
  buttons: SeedButton[]
}

/** 各业务菜单与其按钮权限点（与各 Controller 的 @Perms 声明一一对应） */
const SEED_MENUS: SeedMenu[] = [
  {
    name: '用户管理',
    path: '/system/user',
    component: 'system/user/index',
    icon: 'user',
    sort: 1,
    buttons: [
      { name: '用户新增', permission: 'system:user:add' },
      { name: '用户修改', permission: 'system:user:update' },
      { name: '用户删除', permission: 'system:user:delete' }
    ]
  },
  {
    name: '部门管理',
    path: '/system/dept',
    component: 'system/dept/index',
    icon: 'dept',
    sort: 2,
    buttons: [
      { name: '部门新增', permission: 'system:dept:add' },
      { name: '部门修改', permission: 'system:dept:update' },
      { name: '部门删除', permission: 'system:dept:delete' }
    ]
  },
  {
    name: '字典管理',
    path: '/system/dict',
    component: 'system/dict/index',
    icon: 'dict',
    sort: 3,
    buttons: [
      { name: '字典新增', permission: 'system:dict:add' },
      { name: '字典修改', permission: 'system:dict:update' },
      { name: '字典删除', permission: 'system:dict:delete' }
    ]
  },
  {
    name: '日志管理',
    path: '/system/log',
    component: 'system/log/index',
    icon: 'log',
    sort: 4,
    buttons: [
      { name: '登录日志查询', permission: 'system:log:login' },
      { name: '操作日志查询', permission: 'system:log:oper' },
      { name: '日志删除', permission: 'system:log:delete' },
      { name: '日志导出', permission: 'system:log:export' }
    ]
  },
  {
    name: '公告管理',
    path: '/system/notice',
    component: 'system/notice/index',
    icon: 'notice',
    sort: 5,
    buttons: [
      { name: '公告查询', permission: 'system:notice:list' },
      { name: '公告新增', permission: 'system:notice:add' },
      { name: '公告修改', permission: 'system:notice:update' },
      { name: '公告发布', permission: 'system:notice:publish' },
      { name: '公告删除', permission: 'system:notice:delete' }
    ]
  },
  {
    name: '任务管理',
    path: '/system/task',
    component: 'system/task/index',
    icon: 'task',
    sort: 6,
    buttons: [
      { name: '任务新增', permission: 'system:task:add' },
      { name: '任务修改', permission: 'system:task:update' },
      { name: '任务删除', permission: 'system:task:delete' }
    ]
  }
]

/**
 * 菜单按钮权限录入迁移
 * 幂等设计：按 name+type / permission 判重，已有记录不重复插入，可安全重复执行
 */
export class Migration1793759073115 implements MigrationInterface {
  name = 'Migration1793759073115'

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. 确保系统管理目录存在（type 0）
    let sysId = await this.findId(queryRunner, '系统管理', 0)
    if (!sysId) {
      await queryRunner.query(
        `INSERT INTO menu (name, type, path, icon, parentId, sort, status, created_at, updated_at)
         VALUES ('系统管理', 0, '/system', 'setting', 0, 1, 1, NOW(6), NOW(6))`
      )
      sysId = await this.findId(queryRunner, '系统管理', 0)
    }
    if (!sysId) {
      throw new Error('系统管理目录创建失败')
    }

    // 2. 逐个确保业务菜单（type 1）与按钮（type 2）存在
    for (const seed of SEED_MENUS) {
      let menuId = await this.findId(queryRunner, seed.name, 1)
      if (!menuId) {
        await queryRunner.query(
          `INSERT INTO menu (name, type, path, component, icon, parentId, sort, status, created_at, updated_at)
           VALUES (?, 1, ?, ?, ?, ?, ?, 1, NOW(6), NOW(6))`,
          [seed.name, seed.path, seed.component, seed.icon, sysId, seed.sort]
        )
        menuId = await this.findId(queryRunner, seed.name, 1)
      }
      if (!menuId) {
        throw new Error(`菜单 ${seed.name} 创建失败`)
      }
      // 历史遗留：早期录入的按钮可能挂在 parentId=0 的游离状态，统一挂回对应父菜单
      for (const button of seed.buttons) {
        await queryRunner.query(`UPDATE menu SET parentId = ? WHERE permission = ? AND parentId = 0`, [menuId, button.permission])
      }
      for (const [index, button] of seed.buttons.entries()) {
        const exists = await queryRunner.query(`SELECT id FROM menu WHERE permission = ? LIMIT 1`, [button.permission])
        if (exists.length > 0) {
          continue
        }
        await queryRunner.query(
          `INSERT INTO menu (name, type, permission, parentId, sort, status, created_at, updated_at)
           VALUES (?, 2, ?, ?, ?, 1, NOW(6), NOW(6))`,
          [button.name, button.permission, menuId, index + 1]
        )
      }
    }
  }

  /** 回滚：删除按钮权限记录；菜单本身保留（避免误删用户已绑定角色的既有菜单） */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const permissions = SEED_MENUS.flatMap(menu => menu.buttons.map(button => button.permission))
    await queryRunner.query(`DELETE FROM menu WHERE type = 2 AND permission IN (?)`, [permissions])
  }

  /** 按名称与类型查菜单 ID */
  private async findId(queryRunner: QueryRunner, name: string, type: number): Promise<number | null> {
    const rows: Array<{ id: number }> = await queryRunner.query(`SELECT id FROM menu WHERE name = ? AND type = ? ORDER BY id ASC LIMIT 1`, [name, type])
    return rows.length > 0 ? rows[0].id : null
  }
}
