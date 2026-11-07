import { type MigrationInterface, type QueryRunner } from 'typeorm'

/** 生成器产物：供应商表（supplier） */
export class GenSupplier1794072824359 implements MigrationInterface {
  name = 'GenSupplier1794072824359'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`supplier\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`tenant_id\` int NOT NULL DEFAULT 1 COMMENT '租户ID(0=平台共享)',
        \`name\` VARCHAR(128) NOT NULL COMMENT '供应商名称',
        \`contact\` VARCHAR(128) NULL DEFAULT NULL COMMENT '联系人',
        \`level\` TINYINT NULL DEFAULT '1' COMMENT '级别',
        \`remark\` VARCHAR(128) NULL DEFAULT NULL COMMENT '备注',
        \`del_flag\` tinyint NOT NULL DEFAULT 0 COMMENT '0正常 1已删除',
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        KEY \`idx_supplier_tenant\` (\`tenant_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='供应商'
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS \`supplier\``)
  }
}
