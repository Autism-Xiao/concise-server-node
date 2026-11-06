import { type MigrationInterface, type QueryRunner } from 'typeorm'

/**
 * 日志导入权限
 *
 * 日志管理新增「导入」接口（登录日志 / 操作日志各一对模板+导入），
 * 与用户、角色、职级等模块保持一致，单独挂一个按钮级权限点 system:log:import。
 * 幂等：已存在同 perms 的记录时不再插入，重复跑迁移不会产生脏数据。
 */
const PERMISSION_ID = 'menu_77'
const PERMISSION_CODE = 'system:log:import'

export class AddLogImportPermission1793966203743 implements MigrationInterface {
  name = 'AddLogImportPermission1793966203743'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO sys_permission
         (id, parent_id, name, url, component, is_route, menu_type, perms, perms_type, sort_no, is_leaf, keep_alive, hidden, hide_tab, status, del_flag, create_time)
       SELECT ?, 'menu_18', '日志导入', NULL, NULL, 1, 2, ?, '1', 6, 1, 0, 0, 0, '1', 0, NOW()
       FROM DUAL
       WHERE NOT EXISTS (SELECT 1 FROM sys_permission WHERE perms = ?)`,
      [PERMISSION_ID, PERMISSION_CODE, PERMISSION_CODE]
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DELETE FROM sys_role_permission WHERE permission_id IN (SELECT id FROM sys_permission WHERE perms = ?)', [PERMISSION_CODE])
    await queryRunner.query('DELETE FROM sys_permission WHERE perms = ?', [PERMISSION_CODE])
  }
}
