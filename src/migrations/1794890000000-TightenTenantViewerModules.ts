import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 收回租户「访客」的组织架构、数据字典、行政区划与文件库权限，并清掉过滤后变空的目录
 *
 * 背景：`acceptsByLevel` 对只读档按权限码**后缀**判定，白名单含 `list` / `export` / `download`。
 * 于是只要某个页面挂了一个 `:list` 按钮，访客就自动获得整页 —— 这套规则适合业务数据，
 * 不适合「系统配置」和「全租户文件库」。本次收的是后者：
 *
 * 1. 部门 / 岗位 / 职级 —— 组织架构属配置数据，管理职责。选部门控件走 `GET /depts/tree`（不挂 @Perms），不受影响
 * 2. 数据字典 —— 配置入口。所有下拉走 `GET /dict-items/code/:code`（不挂 @Perms），收回不影响任何表单
 * 3. 行政区划 —— 公共数据，访客没有实际用途
 * 4. 文件管理 + 文件下载 —— **最该收的一条**：`system:file:list` 能列出该租户所有人上传的附件，
 *    `system:file:download` 能下载任意一个，而文件没有按人隔离。这是访客权限里唯一能拉到具体文件内容的洞
 *
 * **只动 viewer**：编辑者要维护基础数据、上传下载任务附件，收掉会把编辑者打瘸。
 *
 * 第二步清「空目录」：子页面全被排除后，目录节点本身还留着授权，
 * 前端 `treeToGroups` 会把空分组当普通菜单项渲染 —— 侧边栏出现「系统管理」「数据管理」「安全审计」，
 * 点进去是空页或 404（/audit 前端根本没有路由）。判定用「有子节点但该角色一条子授权都没有」，
 * 不按 menu_type：仪表盘是 menu_type=0 的顶级单页菜单，按类型判会误删。
 */
const VIEWER_MODULES = ['dept', 'post', 'level', 'dict', 'region', 'file'] as const

export class TightenTenantViewerModules1794890000000 implements MigrationInterface {
  name = 'TightenTenantViewerModules1794890000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) 删模块授权：perms 前缀 + url 前缀双条件（页面节点漏写 perms 时靠 url 兜住）
    const moduleCondition = VIEWER_MODULES.map(m => `(p.perms LIKE 'system:${m}%' OR p.url LIKE '/system/${m}%')`).join('\n           OR ')
    await queryRunner.query(`
      DELETE rp FROM sys_role_permission rp
        JOIN sys_role r ON r.id = rp.role_id
        JOIN sys_permission p ON p.id = rp.permission_id
       WHERE r.tenant_id > 0
         AND r.role_code = 'viewer'
         AND (${moduleCondition})
    `)

    // 2) 清空目录：有子节点、但该角色一个子节点授权都没有
    //    多跑几轮，自底向上（A 装 B，B 的子页面丢光后 A 也变空）
    for (let round = 0; round < 3; round += 1) {
      // TypeORM 1.1 的 queryRunner.query 不吃泛型，只能 as 断言
      const empties = (await queryRunner.query(`
        SELECT rp.role_id AS roleId, rp.permission_id AS permissionId
          FROM sys_role_permission rp
          JOIN sys_role r ON r.id = rp.role_id
          JOIN sys_permission p ON p.id = rp.permission_id
         WHERE r.tenant_id > 0
           AND r.role_code IN ('viewer', 'editor')
           AND p.menu_type = 0
           AND EXISTS (SELECT 1 FROM sys_permission ch WHERE ch.parent_id = p.id AND ch.del_flag = 0)
           AND NOT EXISTS (
             SELECT 1 FROM sys_permission ch
               JOIN sys_role_permission crp ON crp.permission_id = ch.id AND crp.role_id = r.id
              WHERE ch.parent_id = p.id AND ch.del_flag = 0
           )
      `)) as Array<{ roleId: string; permissionId: string }>

      if (!Array.isArray(empties) || !empties.length) break
      for (const row of empties) {
        await queryRunner.query('DELETE FROM sys_role_permission WHERE role_id = ? AND permission_id = ?', [row.roleId, row.permissionId])
      }
    }
  }

  /**
   * 回滚：按改造前的白名单补回模块内的只读节点（幂等）
   *
   * 局限：被删的**目录**节点（系统管理 / 数据管理 / 安全审计）不在这里补 ——
   * 目录本身没有权限码，靠名字猜不可靠。需要完整回滚时重新跑
   * `POST /v1/tenants/provision-all`（幂等补授权），它会按模板重新算出目录。
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const module of VIEWER_MODULES) {
      await queryRunner.query(
        `INSERT IGNORE INTO sys_role_permission (role_id, permission_id, operate_date)
         SELECT r.id, p.id, NOW() FROM sys_role r
           JOIN sys_permission p ON p.del_flag = 0 AND p.status = '1' AND p.scope = 'tenant'
          WHERE r.tenant_id > 0 AND r.role_code = 'viewer'
            AND (p.perms LIKE ? OR p.url LIKE ?)
            AND (
              p.perms IS NULL OR p.perms = ''
              OR SUBSTRING_INDEX(p.perms, ':', -1) IN ('list', 'query', 'detail', 'export', 'download')
            )`,
        [`system:${module}%`, `/system/${module}%`]
      )
    }
  }
}
