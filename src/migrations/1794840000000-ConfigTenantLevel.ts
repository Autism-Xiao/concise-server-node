import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 参数配置租户化（默认版）：
 *
 * 1. sys_config 加 tenant_id（0=平台级）与 allow_tenant（平台是否允许租户覆盖）。
 * 2. 唯一键从 config_key 全局唯一换成 (tenant_id, config_key) 联合唯一：
 *    存量全是平台行（tenant_id=0），全局唯一 ⇒ 联合唯一必然满足，可无损切换。
 * 3. 预置两个租户可覆盖的默认参数（分组 tenant），作为租户级差异化的样板：
 *    - tenant.ui.themeColor     租户主题色（空 = 跟随平台）
 *    - tenant.login.welcomeText 租户登录页欢迎语（空 = 跟随平台）
 *
 * 回滚：删掉新参数行、还原全局唯一索引、删列。回滚要求各租户没有覆盖行，
 * 有覆盖行时 ROLLBACK 会因索引冲突失败，需先清理（DELETE FROM sys_config WHERE tenant_id > 0）。
 */
export class ConfigTenantLevel1794840000000 implements MigrationInterface {
  name = 'ConfigTenantLevel1794840000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TABLE `sys_config` ADD COLUMN `tenant_id` int NOT NULL DEFAULT 0 COMMENT '租户ID(0=平台级)' AFTER `id`")
    await queryRunner.query("ALTER TABLE `sys_config` ADD COLUMN `allow_tenant` tinyint NOT NULL DEFAULT 0 COMMENT '租户可覆盖(1=租户可写)' AFTER `is_builtin`")
    await queryRunner.query('ALTER TABLE `sys_config` DROP INDEX `uk_config_key`')
    await queryRunner.query('ALTER TABLE `sys_config` ADD UNIQUE INDEX `uk_tenant_config_key` (`tenant_id`, `config_key`)')
    await queryRunner.query(
      `INSERT INTO sys_config (config_key, config_value, value_type, config_group, name, remark, is_builtin, allow_tenant, del_flag, created_at, updated_at) VALUES
        ('tenant.ui.themeColor', '', 'string', 'tenant', '租户主题色', '租户品牌主题色，留空跟随平台默认', 1, 1, 0, NOW(), NOW()),
        ('tenant.login.welcomeText', '', 'string', 'tenant', '登录页欢迎语', '展示在本租户登录页的欢迎文案，留空跟随平台默认', 1, 1, 0, NOW(), NOW())`
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DELETE FROM `sys_config` WHERE `config_key` IN ('tenant.ui.themeColor', 'tenant.login.welcomeText')")
    await queryRunner.query('ALTER TABLE `sys_config` DROP INDEX `uk_tenant_config_key`')
    await queryRunner.query('ALTER TABLE `sys_config` ADD UNIQUE INDEX `uk_config_key` (`config_key`)')
    await queryRunner.query('ALTER TABLE `sys_config` DROP COLUMN `allow_tenant`')
    await queryRunner.query('ALTER TABLE `sys_config` DROP COLUMN `tenant_id`')
  }
}
