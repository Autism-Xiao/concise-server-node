import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 审计哈希链（sys_log 防篡改）：
 *
 * - seq：链顺序键（AUTO_INCREMENT，写入顺序即链顺序；id 是随机串不能排序）
 * - prev_hash / entry_hash：租户内链式哈希，entry = sha256(prev + canonical(row))
 *   任何一条历史记录被改动，其后所有租户内记录的校验都会断裂
 *
 * 存量行三个列都是 NULL：校验端把「首个 NULL」当作链起点（迁移点），之前的旧数据不参与校验。
 * 链只保证「迁移点之后不可篡改」，这也是审计的合理口径——存量历史已有 binlog/备份兜底。
 */
export class AuditHashChain1795040000000 implements MigrationInterface {
  name = 'AuditHashChain1795040000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE sys_log
         ADD COLUMN seq BIGINT NOT NULL AUTO_INCREMENT,
         ADD UNIQUE KEY uk_log_seq (seq),
         ADD COLUMN prev_hash VARCHAR(64) NULL COMMENT '链上前一条的 entry_hash（同租户）',
         ADD COLUMN entry_hash VARCHAR(64) NULL COMMENT '本条链哈希 = sha256(prev + canonical)',
         ADD INDEX idx_log_tenant_seq (tenant_id, seq)`
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE sys_log
         DROP INDEX idx_log_tenant_seq,
         DROP COLUMN entry_hash,
         DROP COLUMN prev_hash,
         DROP INDEX uk_log_seq,
         DROP COLUMN seq`
    )
  }
}
