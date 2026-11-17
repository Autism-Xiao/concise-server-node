import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 开通租户需要 VIP：
 *
 * 1. sys_user 加 vip_level（0 普通 / 1 VIP）+ vip_expire_at（空=永久）。
 *    VIP 落点在**用户**而不是租户——开通租户时租户还不存在。
 * 2. sys_config 预置平台级参数 tenant.vip.maxTenants = 1（一个 VIP 可开几个租户）；
 *    allow_tenant = 0，租户不可自调额度。
 * 3. sys_permission 预置按钮权限 system:user:vip（scope=platform）：
 *    只有平台管理员能在用户管理里授予/取消 VIP（PermsGuard 按 scope 要求 is_platform_admin）。
 *
 * 回滚：删权限点、删参数、删列。已开通的租户不受影响（VIP 只是开通资格，不绑定租户生命周期）。
 */
export class UserVip1794850000000 implements MigrationInterface {
  name = 'UserVip1794850000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TABLE `sys_user` ADD COLUMN `vip_level` tinyint NOT NULL DEFAULT 0 COMMENT '会员等级(0普通 1VIP)' AFTER `is_platform_admin`")
    await queryRunner.query("ALTER TABLE `sys_user` ADD COLUMN `vip_expire_at` datetime NULL COMMENT 'VIP到期时间(空=永久)' AFTER `vip_level`")
    await queryRunner.query(
      `INSERT INTO sys_config (config_key, config_value, value_type, config_group, name, remark, is_builtin, allow_tenant, del_flag, created_at, updated_at)
       VALUES ('tenant.vip.maxTenants', '1', 'number', 'tenant', 'VIP 可开通租户数', '一个 VIP 账号最多能自助开通几个租户；平台级参数，租户不可改', 1, 0, 0, NOW(), NOW())`
    )
    await queryRunner.query(
      `INSERT INTO sys_permission (id, parent_id, name, is_route, menu_type, perms, scope, perms_type, sort_no, is_leaf, hidden, del_flag, rule_flag, status, create_time)
       VALUES ('menu_user_vip', 'menu_2', 'VIP 设置', 1, 2, 'system:user:vip', 'platform', '1', 9, 1, 0, 0, 0, '1', NOW())`
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DELETE FROM sys_permission WHERE id = 'menu_user_vip'")
    await queryRunner.query("DELETE FROM sys_config WHERE config_key = 'tenant.vip.maxTenants' AND tenant_id = 0")
    await queryRunner.query('ALTER TABLE `sys_user` DROP COLUMN `vip_expire_at`')
    await queryRunner.query('ALTER TABLE `sys_user` DROP COLUMN `vip_level`')
  }
}
