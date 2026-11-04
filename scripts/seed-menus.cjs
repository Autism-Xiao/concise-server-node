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
    { id: 'menu_27', parent: null, name: '任务', url: '/tasks', type: 0, sort: 2, icon: 'ListTodo' }, // 原「任务管理」上移
    { id: 'menu_36', parent: null, name: '应用', url: '/apps', type: 0, sort: 3, icon: 'AppWindow' },
    { id: 'menu_37', parent: null, name: '聊天', url: '/chats', type: 0, sort: 4, icon: 'MessagesSquare' },
    { id: 'menu_1', parent: null, name: '系统管理', url: '/system', type: 0, sort: 6, icon: 'Settings' },
    { id: 'menu_38', parent: null, name: '运维管理', url: '/ops', type: 0, sort: 17, icon: 'Server' },
    // ---- 系统管理子菜单 ----
    { id: 'menu_2', parent: 'menu_1', name: '用户管理', url: '/system/users', type: 1, sort: 7, icon: 'Users' }, // 原 /system/user 修正
    { id: 'menu_39', parent: 'menu_1', name: '菜单管理', url: '/system/menu', type: 1, sort: 8, icon: 'ListTree' },
    { id: 'menu_40', parent: 'menu_1', name: '角色权限', url: '/system/role', type: 1, sort: 9, icon: 'ShieldCheck' },
    { id: 'menu_10', parent: 'menu_1', name: '部门管理', url: '/system/dept', type: 1, sort: 10, icon: 'Building2' },
    { id: 'menu_14', parent: 'menu_1', name: '字典管理', url: '/system/dict', type: 1, sort: 11, icon: 'Database', status: '0' }, // 停用
    { id: 'menu_18', parent: 'menu_1', name: '日志管理', url: '/system/log', type: 1, sort: 12, icon: 'ScrollText' },
    { id: 'menu_31', parent: 'menu_1', name: '文件管理', url: '/system/file', type: 1, sort: 13, icon: 'FolderOpen' }, // 原「存储管理 /tools/storage」修正
    { id: 'menu_41', parent: 'menu_1', name: '日历管理', url: '/system/calendar', type: 1, sort: 14, icon: 'CalendarDays' },
    { id: 'menu_42', parent: 'menu_1', name: '职级管理', url: '/system/level', type: 1, sort: 22, icon: 'Medal' },
    { id: 'menu_43', parent: 'menu_1', name: '岗位管理', url: '/system/post', type: 1, sort: 23, icon: 'Briefcase' },
    { id: 'menu_44', parent: 'menu_1', name: '租户管理', url: '/system/tenant', type: 1, sort: 24, icon: 'Network' },
    { id: 'menu_21', parent: 'menu_1', name: '通知公告', url: '/system/notice', type: 1, sort: 25, icon: 'Megaphone' }, // 原「公告管理」
    { id: 'menu_45', parent: 'menu_1', name: '行政区划', url: '/system/region', type: 1, sort: 26, icon: 'MapPin' },
    // ---- 日志管理子菜单 ----
    { id: 'menu_46', parent: 'menu_18', name: '登录日志', url: '/system/log/login', type: 1, sort: 15, icon: 'LogIn' },
    { id: 'menu_47', parent: 'menu_18', name: '操作日志', url: '/system/log/operation', type: 1, sort: 16, icon: 'FileText' },
    // ---- 运维管理子菜单 ----
    { id: 'menu_48', parent: 'menu_38', name: '定时任务', url: '/ops/job', type: 1, sort: 18, icon: 'Timer' },
    { id: 'menu_49', parent: 'menu_38', name: '在线用户', url: '/ops/online', type: 1, sort: 19, icon: 'UserCheck' },
    { id: 'menu_50', parent: 'menu_38', name: '服务监控', url: '/ops/server', type: 1, sort: 20, icon: 'Activity' },
    { id: 'menu_51', parent: 'menu_38', name: '缓存监控', url: '/ops/cache', type: 1, sort: 21, icon: 'Package' }
  ]

  const parentIds = new Set(MENUS.filter(m => m.type === 0).map(m => m.id))

  let updated = 0
  let inserted = 0
  for (const m of MENUS) {
    const status = m.status ?? '1'
    const isLeaf = 1 // 目前菜单项都是叶子；有子级的目录由下方二次修正
    const exists = await ds.query('SELECT id FROM sys_permission WHERE id = ?', [m.id])
    if (exists.length) {
      await ds.query(
        'UPDATE sys_permission SET parent_id=?, name=?, url=?, menu_type=?, status=?, sort_no=?, icon=?, del_flag=0, update_time=NOW() WHERE id=?',
        [m.parent, m.name, m.url, m.type, status, m.sort, m.icon ?? null, m.id]
      )
      updated++
    } else {
      await ds.query(
        `INSERT INTO sys_permission (id, parent_id, name, url, menu_type, status, sort_no, icon, is_route, is_leaf, hidden, perms_type, del_flag, rule_flag, create_by, create_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, '1', 0, 0, 'seed', NOW())`,
        [m.id, m.parent, m.name, m.url, m.type, status, m.sort, m.icon ?? null, isLeaf]
      )
      inserted++
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
