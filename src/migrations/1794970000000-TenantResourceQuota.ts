import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 租户级资源配额（默认版）：
 *
 * 在 sys_config 里预置两条平台行，allow_tenant=1（租户可覆盖）：
 * - tenant.quota.maxUsers    租户最大在册用户数，0 = 不限制（默认）
 * - tenant.quota.maxStorageMb 租户最大文件存储（MB），0 = 不限制（默认）
 *
 * 默认 0 是为了存量租户与本地库零影响：升级后不配置 = 行为不变。
 * 配额值只有 QuotaService 消费；配在平台行上是全局默认，租户覆盖行按 (tenant_id, key) 生效。
 */
export class TenantResourceQuota1794970000000 implements MigrationInterface {
  name = 'TenantResourceQuota1794970000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO sys_config (config_key, config_value, value_type, config_group, name, remark, is_builtin, allow_tenant, del_flag, created_at, updated_at) VALUES
        ('tenant.quota.maxUsers', '0', 'number', 'tenant', '租户用户数上限', '在册用户数（不含软删），0=不限制；租户可覆盖', 1, 1, 0, NOW(), NOW()),
        ('tenant.quota.maxStorageMb', '0', 'number', 'tenant', '租户存储上限(MB)', '文件中心未删除文件字节数之和，0=不限制；租户可覆盖', 1, 1, 0, NOW(), NOW())`
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DELETE FROM `sys_config` WHERE `config_key` IN ('tenant.quota.maxUsers', 'tenant.quota.maxStorageMb')")
  }
}
