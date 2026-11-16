import { type MigrationInterface, type QueryRunner } from 'typeorm'

/**
 * 两步验证备份恢复码表
 *
 * 补的是 2FA 的「最后一条后路」：认证器丢失时用一次性码登录，
 * 而不是让运维去数据库里改 totp_enabled。只存 sha256，明文只在生成时返回一次。
 */
export class CreateBackupCode1794410000000 implements MigrationInterface {
  name = 'CreateBackupCode1794410000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`sys_user_backup_code\` (
        \`id\` char(36) NOT NULL COMMENT '主键',
        \`user_id\` varchar(32) NOT NULL COMMENT '用户ID',
        \`code_hash\` char(64) NOT NULL COMMENT '备份码 sha256 摘要',
        \`used_at\` datetime(6) NULL COMMENT '使用时间(空=未使用)',
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
        PRIMARY KEY (\`id\`),
        KEY \`idx_backup_user\` (\`user_id\`, \`used_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='两步验证备份恢复码'
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `sys_user_backup_code`')
  }
}
