/**
 * 菜单数据补全脚本（幂等，可重复执行）
 *
 * 依据前端 concise-admin 的真实路由（src/routes/_authenticated/**）灌入菜单树：
 * - 已有记录按 id 更新（url / 名称 / 排序 / 状态）
 * - 缺失记录按既定 id 插入（menu_35 起）
 * - 按钮权限（menu_type=2）保持不变
 *
 * 用法：node scripts/seed-menus.cjs
 */
;(async () => {
  const { NestFactory } = require('@nestjs/core')
  const { AppModule } = require('../dist/app.module')
  const { getDataSourceToken } = require('@nestjs/typeorm')

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false })
  const ds = app.get(getDataSourceToken('default'))

  /**
   * 目标菜单树（对齐前端路由）
   * type: 0 一级菜单 / 1 子菜单；status: '1' 有效 / '0' 停用
   */
  const MENUS = [
    // ---- 顶级 ----
    { id: 'menu_35', parent: null, name: '仪表盘', url: '/dashboard', type: 0, sort: 1, icon: 'LayoutDashboard' },
    { id: 'menu_27', parent: null, name: '任务', url: '/tasks', type: 0, sort: 2, icon: 'ListTodo', perms: 'system:task:list' }, // 原「任务管理」上移
    { id: 'menu_36', parent: null, name: '应用', url: '/apps', type: 0, sort: 3, icon: 'AppWindow' },
    { id: 'menu_37', parent: null, name: '聊天', url: '/chats', type: 0, sort: 4, icon: 'MessagesSquare' },
    { id: 'menu_1', parent: null, name: '系统管理', url: '/system', type: 0, sort: 6, icon: 'Settings' },
    { id: 'menu_38', parent: null, name: '运维管理', url: '/ops', type: 0, sort: 17, icon: 'Server' },
    // ---- 系统管理子菜单 ----
    { id: 'menu_2', parent: 'menu_1', name: '用户管理', url: '/system/users', type: 1, sort: 7, icon: 'Users', perms: 'system:user:list' }, // 原 /system/user 修正
    { id: 'menu_39', parent: 'menu_1', name: '菜单管理', url: '/system/menu', type: 1, sort: 8, icon: 'ListTree', perms: 'system:menu:list' },
    { id: 'menu_40', parent: 'menu_1', name: '角色权限', url: '/system/role', type: 1, sort: 9, icon: 'ShieldCheck', perms: 'system:role:list' },
    { id: 'menu_10', parent: 'menu_1', name: '部门管理', url: '/system/dept', type: 1, sort: 10, icon: 'Building2', perms: 'system:dept:list' },
    { id: 'menu_14', parent: 'menu_1', name: '数据字典', url: '/system/dict', type: 1, sort: 11, icon: 'Database', perms: 'system:dict:list' },
    { id: 'menu_18', parent: 'menu_1', name: '日志管理', url: '/system/log', type: 1, sort: 12, icon: 'ScrollText' },
    { id: 'menu_31', parent: 'menu_1', name: '文件管理', url: '/system/file', type: 1, sort: 13, icon: 'FolderOpen' }, // 原「存储管理 /tools/storage」修正
    { id: 'menu_41', parent: 'menu_1', name: '日历管理', url: '/system/calendar', type: 1, sort: 14, icon: 'CalendarDays' },
    { id: 'menu_42', parent: 'menu_1', name: '职级管理', url: '/system/level', type: 1, sort: 22, icon: 'Medal', perms: 'system:level:list' },
    { id: 'menu_43', parent: 'menu_1', name: '岗位管理', url: '/system/post', type: 1, sort: 23, icon: 'Briefcase', perms: 'system:post:list' },
    { id: 'menu_44', parent: 'menu_1', name: '租户管理', url: '/system/tenant', type: 1, sort: 24, icon: 'Network' },
    { id: 'menu_21', parent: 'menu_1', name: '通知公告', url: '/system/notice', type: 1, sort: 25, icon: 'Megaphone', perms: 'system:notice:list' }, // 原「公告管理」
    { id: 'menu_45', parent: 'menu_1', name: '行政区划', url: '/system/region', type: 1, sort: 26, icon: 'MapPin' },
    // ---- 日志管理子菜单 ----
    { id: 'menu_46', parent: 'menu_18', name: '登录日志', url: '/system/log/login', type: 1, sort: 15, icon: 'LogIn', perms: 'system:log:login' },
    { id: 'menu_47', parent: 'menu_18', name: '操作日志', url: '/system/log/operation', type: 1, sort: 16, icon: 'FileText', perms: 'system:log:oper' },
    // ---- 运维管理子菜单 ----
    { id: 'menu_48', parent: 'menu_38', name: '定时任务', url: '/ops/job', type: 1, sort: 18, icon: 'Timer', perms: 'system:job:list' },
    { id: 'menu_49', parent: 'menu_38', name: '在线用户', url: '/ops/online', type: 1, sort: 19, icon: 'UserCheck', perms: 'system:online:list' },
    { id: 'menu_50', parent: 'menu_38', name: '服务监控', url: '/ops/server', type: 1, sort: 20, icon: 'Activity', perms: 'system:monitor:server' },
    { id: 'menu_51', parent: 'menu_38', name: '缓存监控', url: '/ops/cache', type: 1, sort: 21, icon: 'Package', perms: 'system:monitor:cache' }
  ]

  const parentIds = new Set(MENUS.filter(m => m.type === 0).map(m => m.id))

  let updated = 0
  let inserted = 0
  for (const m of MENUS) {
    const status = m.status ?? '1'
    const isLeaf = 1 // 目前菜单项都是叶子；有子级的目录由下方二次修正
    const exists = await ds.query('SELECT id FROM sys_permission WHERE id = ?', [m.id])
    if (exists.length) {
      const sql = 'UPDATE sys_permission SET parent_id=?, name=?, url=?, menu_type=?, status=?, sort_no=?, icon=?, del_flag=0, update_time=NOW()' + (m.perms ? ', perms=?' : '') + ' WHERE id=?'
      const params = [m.parent, m.name, m.url, m.type, status, m.sort, m.icon ?? null]
      if (m.perms) params.push(m.perms)
      params.push(m.id)
      await ds.query(sql, params)
      updated++
    } else {
      await ds.query(
        `INSERT INTO sys_permission (id, parent_id, name, url, menu_type, perms, status, sort_no, icon, is_route, is_leaf, hidden, perms_type, del_flag, rule_flag, create_by, create_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, '1', 0, 0, 'seed', NOW())`,
        [m.id, m.parent, m.name, m.url, m.type, m.perms ?? null, status, m.sort, m.icon ?? null, isLeaf]
      )
      inserted++
    }
  }

  // ---- 按钮权限（menu_type=2，幂等） ----
  const BUTTONS = [
    // 用户管理（menu_2）：新增/修改/删除已有 menu_7~9，这里只补导入导出
    { id: 'menu_75', parent: 'menu_2', name: '用户导出', perms: 'system:user:export', sort: 4 },
    { id: 'menu_76', parent: 'menu_2', name: '用户导入', perms: 'system:user:import', sort: 5 },
    // 角色管理（menu_40）
    { id: 'menu_52', parent: 'menu_40', name: '角色新增', perms: 'system:role:add', sort: 1 },
    { id: 'menu_53', parent: 'menu_40', name: '角色修改', perms: 'system:role:update', sort: 2 },
    { id: 'menu_54', parent: 'menu_40', name: '角色删除', perms: 'system:role:delete', sort: 3 },
    { id: 'menu_67', parent: 'menu_40', name: '角色导出', perms: 'system:role:export', sort: 4 },
    { id: 'menu_68', parent: 'menu_40', name: '角色导入', perms: 'system:role:import', sort: 5 },
    // 职级管理（menu_42）
    { id: 'menu_55', parent: 'menu_42', name: '职级新增', perms: 'system:level:add', sort: 1 },
    { id: 'menu_56', parent: 'menu_42', name: '职级修改', perms: 'system:level:update', sort: 2 },
    { id: 'menu_57', parent: 'menu_42', name: '职级删除', perms: 'system:level:delete', sort: 3 },
    // 岗位管理（menu_43）
    { id: 'menu_58', parent: 'menu_43', name: '岗位新增', perms: 'system:post:add', sort: 1 },
    { id: 'menu_59', parent: 'menu_43', name: '岗位修改', perms: 'system:post:update', sort: 2 },
    { id: 'menu_60', parent: 'menu_43', name: '岗位删除', perms: 'system:post:delete', sort: 3 },
    // 定时任务（menu_48）
    { id: 'menu_61', parent: 'menu_48', name: '任务新增', perms: 'system:job:add', sort: 1 },
    { id: 'menu_62', parent: 'menu_48', name: '任务修改', perms: 'system:job:update', sort: 2 },
    { id: 'menu_63', parent: 'menu_48', name: '任务删除', perms: 'system:job:delete', sort: 3 },
    { id: 'menu_64', parent: 'menu_48', name: '任务执行', perms: 'system:job:run', sort: 4 },
    // 在线用户（menu_49）
    { id: 'menu_65', parent: 'menu_49', name: '强制下线', perms: 'system:online:kick', sort: 1 },
    // 缓存监控（menu_51）
    { id: 'menu_66', parent: 'menu_51', name: '清理缓存', perms: 'system:monitor:cache:clear', sort: 1 },
    // 菜单管理（menu_39）
    { id: 'menu_69', parent: 'menu_39', name: '菜单新增', perms: 'system:menu:add', sort: 1 },
    { id: 'menu_70', parent: 'menu_39', name: '菜单修改', perms: 'system:menu:update', sort: 2 },
    { id: 'menu_71', parent: 'menu_39', name: '菜单删除', perms: 'system:menu:delete', sort: 3 },
    // 通知公告（menu_21）：查询/新增/修改/发布/删除已有 menu_22~26，这里只补导入
    { id: 'menu_78', parent: 'menu_21', name: '公告导入', perms: 'system:notice:import', sort: 6 }
  ]
  for (const b of BUTTONS) {
    const exists = await ds.query('SELECT id FROM sys_permission WHERE id = ?', [b.id])
    if (exists.length) {
      await ds.query('UPDATE sys_permission SET parent_id=?, name=?, perms=?, menu_type=2, del_flag=0, update_time=NOW() WHERE id=?', [b.parent, b.name, b.perms, b.id])
    } else {
      await ds.query(
        `INSERT INTO sys_permission (id, parent_id, name, perms, menu_type, is_route, is_leaf, hidden, perms_type, del_flag, rule_flag, create_by, create_time)
         VALUES (?, ?, ?, ?, 2, 1, 1, 0, '1', 0, 0, 'seed', NOW())`,
        [b.id, b.parent, b.name, b.perms]
      )
    }
  }

  // 修正 is_leaf：有子菜单的一级/子目录置 0
  for (const pid of parentIds) {
    const hasChildren = await ds.query(
      "SELECT COUNT(*) AS n FROM sys_permission WHERE parent_id = ? AND del_flag = 0 AND menu_type <> 2",
      [pid]
    )
    if (Number(hasChildren[0].n) > 0) {
      await ds.query('UPDATE sys_permission SET is_leaf = 0 WHERE id = ?', [pid])
    }
  }

  console.log(`完成：更新 ${updated} 条，新增 ${inserted} 条`)
  const rows = await ds.query(
    "SELECT id, parent_id, name, url, menu_type, status, sort_no FROM sys_permission WHERE del_flag=0 AND menu_type<>2 ORDER BY sort_no"
  )
  console.log('当前菜单（不含按钮，共 ' + rows.length + ' 条）：')
  rows.forEach(r => console.log(`  ${r.id} | ${r.parent_id ?? '顶级'} | sort:${r.sort_no} | ${r.status === '1' ? '正常' : '停用'} | ${r.name} → ${r.url}`))

  await app.close()
})().catch(e => {
  console.error('ERR', e.message)
  process.exit(1)
})
