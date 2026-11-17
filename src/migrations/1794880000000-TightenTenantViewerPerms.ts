import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 收回租户「访客 / 编辑者」的菜单管理、角色配置与组织架构导出权限
 *
 * 上一次迁移（1794870000000）只收了用户管理，这次把体检出来的其余越权一并处理：
 *
 * 1. `system:menu:*` —— 最严重的一条。sys_permission 是全平台共享表，菜单树不分租户，
 *    访客拿到 `system:menu:update` 就能改所有租户的侧边栏。租户 1 的 viewer 仍有 add/update/delete
 *    三条（operate_date 为 null，是早期手工授权的脏数据，模板生成的租户 19/20 没有）。
 * 2. `system:role:*` —— 角色权限页是「谁能干什么」的配置表，租户内也只该管理员看。
 * 3. 组织架构导出（dept/level/post:export）—— 一条接口就能把整个部门树、岗位、职级拉成文件。
 * 4. `system:log:export` —— 没有配套的 `log:list`，接口拿到了也用不上（死码），
 *    却让「安全审计」这个空分组一直挂在侧边栏（点进去 /audit 前端根本没有路由）。
 *
 * 按 perms 与 url 双条件删：页面节点万一没写 perms，靠 url 兜住（/system/menu、/system/role）。
 * 只动模板角色 viewer/editor，租户自建角色不碰。
 */
export class TightenTenantViewerPerms1794880000000 implements MigrationInterface {
  name = 'TightenTenantViewerPerms1794880000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE rp FROM sys_role_permission rp
        JOIN sys_role r ON r.id = rp.role_id
        JOIN sys_permission p ON p.id = rp.permission_id
       WHERE r.tenant_id > 0
         AND r.role_code IN ('viewer', 'editor')
         AND (
           p.perms LIKE 'system:menu:%' OR p.url LIKE '/system/menu%'
           OR p.perms LIKE 'system:role:%' OR p.url LIKE '/system/role%'
           OR p.perms IN ('system:log:export', 'system:dept:export', 'system:level:export', 'system:post:export')
         )
    `)
  }

  /**
   * 回滚：按改造前的白名单规则补回（幂等）
   *
   * viewer 只补 list / export；editor 补非破坏性后缀（add / update / list / export）。
   * delete / reset-password / restore 这类当时就没给的，不补。
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const legacyGrants: Array<{ roleCode: string; perms: string }> = [
      { roleCode: 'viewer', perms: 'system:menu:list' },
      { roleCode: 'viewer', perms: 'system:role:list' },
      { roleCode: 'viewer', perms: 'system:role:export' },
      { roleCode: 'viewer', perms: 'system:dept:export' },
      { roleCode: 'viewer', perms: 'system:level:export' },
      { roleCode: 'viewer', perms: 'system:post:export' },
      { roleCode: 'viewer', perms: 'system:log:export' },
      { roleCode: 'editor', perms: 'system:menu:list' },
      { roleCode: 'editor', perms: 'system:menu:add' },
      { roleCode: 'editor', perms: 'system:menu:update' },
      { roleCode: 'editor', perms: 'system:role:list' },
      { roleCode: 'editor', perms: 'system:role:add' },
      { roleCode: 'editor', perms: 'system:role:update' },
      { roleCode: 'editor', perms: 'system:role:export' },
      { roleCode: 'editor', perms: 'system:dept:export' },
      { roleCode: 'editor', perms: 'system:level:export' },
      { roleCode: 'editor', perms: 'system:post:export' },
      { roleCode: 'editor', perms: 'system:log:export' }
    ]
    for (const grant of legacyGrants) {
      await queryRunner.query(
        `INSERT IGNORE INTO sys_role_permission (role_id, permission_id, operate_date)
         SELECT r.id, p.id, NOW() FROM sys_role r
           JOIN sys_permission p ON p.perms = ? AND p.del_flag = 0
          WHERE r.tenant_id > 0 AND r.role_code = ?`,
        [grant.perms, grant.roleCode]
      )
    }
  }
}
