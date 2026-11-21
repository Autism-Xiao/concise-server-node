import { MigrationInterface, QueryRunner } from 'typeorm'

/** 租户用量计量表：按 (tenant_id, metric, YYYYMM) 原子累加，供后续配额告警与阶梯计费取数 */
export class CreateTenantUsage1794980000000 implements MigrationInterface {
  name = 'CreateTenantUsage1794980000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS \`sys_tenant_usage\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`tenant_id\` int NOT NULL DEFAULT 0 COMMENT '租户ID',
        \`metric\` varchar(64) NOT NULL COMMENT '指标名',
        \`period\` varchar(6) NOT NULL COMMENT '账期 YYYYMM',
        \`value\` bigint NOT NULL DEFAULT 0 COMMENT '累计值',
        \`created_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        \`updated_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_tenant_usage_metric\` (\`tenant_id\`, \`metric\`, \`period\`),
        KEY \`idx_tenant_usage_period\` (\`period\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='租户月度用量汇总'`
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `sys_tenant_usage`')
  }
}
