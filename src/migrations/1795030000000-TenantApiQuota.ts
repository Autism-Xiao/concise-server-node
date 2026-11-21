import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 租户 API 调用量配额（默认版）：
 *
 * 在 sys_config 里预置一条平台行，allow_tenant=1（租户可覆盖）：
 * - tenant.quota.apiCalls 租户当月 API 调用量上限，0 = 不限制（默认）
 *
 * 消费端 QuotaGuard（APP_GUARD）：按 metering 的 api.calls 月账期计数拦截（429），
 * /v1/health、/v1/metering、/v1/auth 在白名单。默认 0 = 升级后行为不变。
 */
export class TenantApiQuota1795030000000 implements MigrationInterface {
  name = 'TenantApiQuota1795030000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO sys_config (config_key, config_value, value_type, config_group, name, remark, is_builtin, allow_tenant, del_flag, created_at, updated_at) VALUES
        ('tenant.quota.apiCalls', '0', 'number', 'tenant', '租户月度API调用量上限', '全部成功请求按月累计（metering 计数），0=不限制；租户可覆盖', 1, 1, 0, NOW(), NOW())`
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DELETE FROM `sys_config` WHERE `config_key` = 'tenant.quota.apiCalls'")
  }
}
