import { type MigrationInterface, type QueryRunner } from 'typeorm'

/**
 * 菜单重新分组：把平铺在「系统管理」下的 13 个子项按职责拆成 5 个顶层分组
 *
 * 仪表盘 / 系统管理 / 数据管理 / 运维管理 / 安全审计 / 协同办公
 *
 * 拆分依据（也是以后新增菜单的归属判定）：
 * - 系统管理：改这里会改变「谁能看到什么」—— 用户、角色、菜单、部门、岗位、职级、租户
 * - 数据管理：被别的模块引用的基础数据与资源 —— 数据字典、行政区划、文件管理
 * - 运维管理：看系统当前状态、跑后台批处理 —— 在线用户、服务监控、缓存监控、定时任务
 * - 安全审计：事后追溯「谁在什么时候做了什么」—— 登录日志、操作日志
 * - 协同办公：人与人之间发东西、约时间 —— 通知公告、日历管理
 *
 * 顺带修四类数据问题：
 * 1. 行政区划的接口要求 system:region:* 五个权限码，但菜单节点 perms 是 NULL，
 *    结果「所有登录用户都看得见菜单、点进去 403」，而角色权限页也没有按钮可勾 —— 补 5 个按钮节点
 * 2. 前端按钮靠 hasPermission 控制显隐，但 system:user:reset-password / system:user:restore /
 *    system:watermark:edit 三个权限码在表里没有节点，非 admin 永远看不到按钮 —— 补 3 个按钮节点
 * 3. 「日志管理」目录下的「日志查询」「操作日志查看」两条按钮，perms 与两个子菜单完全重复；
 *    审计员角色（auditor）只被授了这两条按钮、没授菜单，导致它有接口权限却看不到日志页面 ——
 *    先给 auditor 补菜单授权，再删掉重复按钮
 * 4. 顶层与同级 sort_no 是跨组连号（系统管理 6、子项 7-14 与 22-26、运维 17、子项 18-21），
 *    插新菜单容易撞号 —— 统一改成「顶层 10/20/30…、组内 1..n」
 *
 * 没动的东西：
 * - 文件管理下 tools:upload / tools:storage:list / tools:storage:delete 三条按钮看起来和
 *   system:file:* 重复，但 tools/storage、tools/upload 两个旧版控制器仍在 modules 里注册
 *   （非 /v1 前缀，未受 LEGACY_ROUTES_ENABLED 控制），权限码仍在生效，删了会导致旧接口无人可授权
 * - 页面路由（url）一律不动，只改 parent_id 与 sort_no，前端 PAGE_REGISTRY 无需同步
 * - 角色授权：AuthService.getPermissions 会把祖先目录自动补齐进菜单树，新分组不需要逐个授权
 */

interface TopGroup {
  id: string
  name: string
  url: string
  sortNo: number
  icon: string
}

const TOP_GROUPS: TopGroup[] = [
  { id: 'menu_data', name: '数据管理', url: '/data', sortNo: 30, icon: 'Database' },
  { id: 'menu_audit', name: '安全审计', url: '/audit', sortNo: 50, icon: 'ShieldCheck' },
  { id: 'menu_collab', name: '协同办公', url: '/collab', sortNo: 60, icon: 'Handshake' }
]

/** [菜单 id, 新上级, 新组内排序] */
const MOVES: Array<[string, string, number]> = [
  // 系统管理：账号与权限
  ['menu_2', 'menu_1', 1],
  ['menu_40', 'menu_1', 2],
  ['menu_39', 'menu_1', 3],
  ['menu_10', 'menu_1', 4],
  ['menu_43', 'menu_1', 5],
  ['menu_42', 'menu_1', 6],
  ['menu_44', 'menu_1', 7],
  // 数据管理：基础数据与资源
  ['menu_14', 'menu_data', 1],
  ['menu_45', 'menu_data', 2],
  ['menu_31', 'menu_data', 3],
  // 运维管理：运行状态（父级不变，只重排）
  ['menu_48', 'menu_38', 1],
  ['menu_49', 'menu_38', 2],
  ['menu_50', 'menu_38', 3],
  ['menu_51', 'menu_38', 4],
  // 安全审计：日志从「系统管理 > 日志管理」上提为顶层分组下的两个页面
  ['menu_46', 'menu_audit', 1],
  ['menu_47', 'menu_audit', 2],
  ['menu_19', 'menu_audit', 10],
  ['menu_20', 'menu_audit', 11],
  ['menu_77', 'menu_audit', 12],
  // 协同办公：内容与日程
  ['menu_21', 'menu_collab', 1],
  ['menu_41', 'menu_collab', 2]
]

/** 顶层排序：仪表盘置顶，其余按 10 递增 */
const TOP_SORTS: Array<[string, number]> = [
  ['menu_35', 10],
  ['menu_1', 20],
  ['menu_38', 40]
]

/** 补登的按钮权限节点 */
const NEW_BUTTONS: Array<{ id: string; parent: string; name: string; perms: string; sortNo: number }> = [
  { id: 'menu_96', parent: 'menu_45', name: '区划新增', perms: 'system:region:add', sortNo: 1 },
  { id: 'menu_97', parent: 'menu_45', name: '区划修改', perms: 'system:region:update', sortNo: 2 },
  { id: 'menu_98', parent: 'menu_45', name: '区划删除', perms: 'system:region:delete', sortNo: 3 },
  { id: 'menu_99', parent: 'menu_45', name: '区划导入', perms: 'system:region:import', sortNo: 4 },
  { id: 'menu_93', parent: 'menu_2', name: '重置密码', perms: 'system:user:reset-password', sortNo: 6 },
  { id: 'menu_94', parent: 'menu_2', name: '恢复用户', perms: 'system:user:restore', sortNo: 7 },
  { id: 'menu_95', parent: 'menu_1', name: '水印策略', perms: 'system:watermark:edit', sortNo: 8 }
]

/** 一次性删除的节点：两条重复按钮 + 被拍平的「日志管理」目录 */
const DROP_IDS = ['menu_3', 'menu_4', 'menu_18']

/** down 回滚用的原始位置（取自迁移执行前的库内真实值） */
const ORIGINAL: Array<[string, string | null, number]> = [
  ['menu_35', null, 1],
  ['menu_1', null, 6],
  ['menu_38', null, 17],
  ['menu_2', 'menu_1', 7],
  ['menu_39', 'menu_1', 8],
  ['menu_40', 'menu_1', 9],
  ['menu_10', 'menu_1', 10],
  ['menu_14', 'menu_1', 11],
  ['menu_31', 'menu_1', 13],
  ['menu_41', 'menu_1', 14],
  ['menu_42', 'menu_1', 22],
  ['menu_43', 'menu_1', 23],
  ['menu_44', 'menu_1', 24],
  ['menu_21', 'menu_1', 25],
  ['menu_45', 'menu_1', 26],
  ['menu_46', 'menu_18', 15],
  ['menu_47', 'menu_18', 16],
  ['menu_48', 'menu_38', 18],
  ['menu_49', 'menu_38', 19],
  ['menu_50', 'menu_38', 20],
  ['menu_51', 'menu_38', 21],
  ['menu_19', 'menu_18', 3],
  ['menu_20', 'menu_18', 4],
  ['menu_77', 'menu_18', 6]
]

export class ReorganizeMenuGroups1794180000000 implements MigrationInterface {
  name = 'ReorganizeMenuGroups1794180000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. 新建三个顶层目录（父级为 NULL，menu_type=0 表示目录）
    for (const g of TOP_GROUPS) {
      await queryRunner.query(
        `INSERT IGNORE INTO \`sys_permission\`
         (\`id\`, \`parent_id\`, \`name\`, \`url\`, \`is_route\`, \`menu_type\`, \`perms\`, \`perms_type\`, \`sort_no\`, \`icon\`, \`is_leaf\`, \`hidden\`, \`del_flag\`, \`rule_flag\`, \`status\`, \`create_time\`)
         VALUES (?, NULL, ?, ?, 1, 0, NULL, '1', ?, ?, 0, 0, 0, 0, '1', NOW())`,
        [g.id, g.name, g.url, g.sortNo, g.icon]
      )
    }

    // 2. 顶层排序 + 固定图标（侧边栏图标优先读库里的 icon 字段）
    for (const [id, sortNo] of TOP_SORTS) {
      await queryRunner.query('UPDATE `sys_permission` SET `sort_no` = ?, `update_time` = NOW() WHERE `id` = ?', [sortNo, id])
    }

    // 3. 把 18 个页面重新挂到新分组，并按组内 1..n 重排
    for (const [id, parentId, sortNo] of MOVES) {
      await queryRunner.query('UPDATE `sys_permission` SET `parent_id` = ?, `sort_no` = ?, `update_time` = NOW() WHERE `id` = ?', [parentId, sortNo, id])
    }

    // 4. 行政区划菜单自身补上列表权限码：没有它，菜单对所有登录用户可见但接口一律 403
    await queryRunner.query("UPDATE `sys_permission` SET `perms` = 'system:region:list', `update_time` = NOW() WHERE `id` = 'menu_45'")

    // 5. 补登缺失的按钮权限节点
    for (const b of NEW_BUTTONS) {
      await queryRunner.query(
        `INSERT IGNORE INTO \`sys_permission\`
         (\`id\`, \`parent_id\`, \`name\`, \`perms\`, \`menu_type\`, \`status\`, \`sort_no\`, \`is_route\`, \`is_leaf\`, \`hidden\`, \`perms_type\`, \`del_flag\`, \`rule_flag\`, \`create_time\`)
         VALUES (?, ?, ?, ?, 2, '1', ?, 1, 1, 0, '1', 0, 0, NOW())`,
        [b.id, b.parent, b.name, b.perms, b.sortNo]
      )
    }

    // 6. 审计员原本只有两条「按钮级」日志权限、没授菜单，先补菜单授权再删按钮，避免它丢掉日志接口权限
    for (const permissionId of ['menu_46', 'menu_47']) {
      await queryRunner.query(
        "INSERT INTO `sys_role_permission` (`id`, `role_id`, `permission_id`) SELECT REPLACE(UUID(), '-', ''), r.`id`, ? FROM `sys_role` r WHERE r.`role_code` = 'auditor' AND NOT EXISTS (SELECT 1 FROM `sys_role_permission` rp WHERE rp.`role_id` = r.`id` AND rp.`permission_id` = ?)",
        [permissionId, permissionId]
      )
    }

    // 7. 删掉重复按钮与被拍平的目录（授权行一起删，避免孤儿引用）
    const placeholders = DROP_IDS.map(() => '?').join(', ')
    await queryRunner.query(`DELETE FROM \`sys_role_permission\` WHERE \`permission_id\` IN (${placeholders})`, DROP_IDS)
    await queryRunner.query(`DELETE FROM \`sys_permission\` WHERE \`id\` IN (${placeholders})`, DROP_IDS)

    // 8. 目录节点的 is_leaf 归位：有子级的必须是 0，否则前端按叶子渲染成不可展开项
    // 注意别写成相关子查询里的派生表（MySQL 不支持对派生表引用外层列），用 JOIN 更稳
    await queryRunner.query('UPDATE `sys_permission` SET `is_leaf` = 1 WHERE `menu_type` <> 2 AND `del_flag` = 0')
    await queryRunner.query(
      `UPDATE \`sys_permission\` p
       JOIN (SELECT DISTINCT \`parent_id\` FROM \`sys_permission\` WHERE \`menu_type\` <> 2 AND \`del_flag\` = 0 AND \`parent_id\` IS NOT NULL) c
         ON p.\`id\` = c.\`parent_id\`
       SET p.\`is_leaf\` = 0`
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 恢复原始位置（含 sort_no）
    for (const [id, parentId, sortNo] of ORIGINAL) {
      await queryRunner.query('UPDATE `sys_permission` SET `parent_id` = ?, `sort_no` = ?, `update_time` = NOW() WHERE `id` = ?', [parentId, sortNo, id])
    }

    // 恢复「日志管理」目录与两条重复按钮
    await queryRunner.query(
      `INSERT IGNORE INTO \`sys_permission\`
       (\`id\`, \`parent_id\`, \`name\`, \`url\`, \`is_route\`, \`menu_type\`, \`perms\`, \`perms_type\`, \`sort_no\`, \`icon\`, \`is_leaf\`, \`hidden\`, \`del_flag\`, \`rule_flag\`, \`status\`)
       VALUES ('menu_18', 'menu_1', '日志管理', '/system/log', 1, 1, NULL, '1', 12, 'ScrollText', 0, 0, 0, 0, '1')`
    )
    await queryRunner.query(
      `INSERT IGNORE INTO \`sys_permission\`
       (\`id\`, \`parent_id\`, \`name\`, \`menu_type\`, \`perms\`, \`perms_type\`, \`sort_no\`, \`is_leaf\`, \`hidden\`, \`del_flag\`, \`rule_flag\`, \`status\`)
       VALUES ('menu_3', 'menu_18', '日志查询', 2, 'system:log:login', '1', 9, 1, 0, 0, 0, '1')`
    )
    await queryRunner.query(
      `INSERT IGNORE INTO \`sys_permission\`
       (\`id\`, \`parent_id\`, \`name\`, \`menu_type\`, \`perms\`, \`perms_type\`, \`sort_no\`, \`is_leaf\`, \`hidden\`, \`del_flag\`, \`rule_flag\`, \`status\`)
       VALUES ('menu_4', 'menu_18', '操作日志查看', 2, 'system:log:oper', '1', 10, 1, 0, 0, 0, '1')`
    )

    // 移除本轮新增的按钮节点与顶层目录
    const extraIds = [...NEW_BUTTONS.map(b => b.id), ...TOP_GROUPS.map(g => g.id)]
    const placeholders = extraIds.map(() => '?').join(', ')
    await queryRunner.query(`DELETE FROM \`sys_role_permission\` WHERE \`permission_id\` IN (${placeholders})`, extraIds)
    await queryRunner.query(`DELETE FROM \`sys_permission\` WHERE \`id\` IN (${placeholders})`, extraIds)

    // 行政区划的 perms 恢复为空
    await queryRunner.query("UPDATE `sys_permission` SET `perms` = NULL WHERE `id` = 'menu_45'")
  }
}
