import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 收回租户「访客 / 编辑者」的用户管理权限
 *
 * 问题现场：访客角色（viewer）被授予了 `system:user:list` + `system:user:export`，
 * 加上模板角色 data_scope 都是 1（全部），结果访客登录后能进「用户管理」，
 * 看到本租户所有人的手机号 / 邮箱，还能整表导出。
 *
 * 根因：tenant-role-template.ts 的只读白名单靠「权限码后缀」判断，
 * `:list` / `:export` 恰好是用户管理的按钮后缀，于是被当成「只读能力」放了出去。
 * 那里已经加了模块级排除（TENANT_RESTRICTED_MODULES），但 provision 只做「补齐差集」，
 * 从不回收授权 —— 存量租户的越权授权必须由本迁移一次性删掉，否则改模板对老租户无效。
 *
 * 范围：只处理模板角色（viewer / editor）。租户自己建的自定义角色不动 ——
 * 迁移不该替用户猜测业务意图，那些角色需要租户管理员自查。
 *
 * 生效时机：权限缓存（Redis，TTL 300s）与进程内平台权限缓存最多 5 分钟后自动生效；
 * 要立刻生效就重启后端，或让用户重新登录。
 */
export class TightenTenantUserMenu1794870000000 implements MigrationInterface {
  name = 'TightenTenantUserMenu1794870000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 「用户管理」整棵子树：页面节点 url=/system/users、perms=system:user:list，再向下递归所有按钮
    const raw = await queryRunner.query(`
      WITH RECURSIVE user_menu AS (
        SELECT id FROM sys_permission
         WHERE del_flag = 0 AND (url = '/system/users' OR url LIKE '/system/users/%' OR perms LIKE 'system:user%')
        UNION ALL
        SELECT p.id FROM sys_permission p JOIN user_menu u ON p.parent_id = u.id
         WHERE p.del_flag = 0
      )
      SELECT DISTINCT id FROM user_menu
    `)
    const rows = (Array.isArray(raw) ? raw : []) as Array<{ id: string }>
    const ids = rows.map(row => String(row.id)).filter(Boolean)
    if (!ids.length) return

    const placeholders = ids.map(() => '?').join(',')
    await queryRunner.query(
      `DELETE rp FROM sys_role_permission rp
         JOIN sys_role r ON r.id = rp.role_id
        WHERE r.tenant_id > 0
          AND r.role_code IN ('viewer', 'editor')
          AND rp.permission_id IN (${placeholders})`,
      ids
    )
  }

  /**
   * 回滚：把旧规则下会授予的按钮重新补回去（幂等）
   *
   * 只恢复当时实际会发放的那几个权限码，不是整棵子树 —— 这样回滚后的状态与改造前一致，
   * 不会顺手把 add/delete 这类当时也没给的权限补出来。
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const legacyGrants: Array<{ roleCode: string; perms: string }> = [
      { roleCode: 'viewer', perms: 'system:user:list' },
      { roleCode: 'viewer', perms: 'system:user:export' },
      { roleCode: 'editor', perms: 'system:user:list' },
      { roleCode: 'editor', perms: 'system:user:export' },
      { roleCode: 'editor', perms: 'system:user:import' },
      { roleCode: 'editor', perms: 'system:user:add' },
      { roleCode: 'editor', perms: 'system:user:update' }
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
