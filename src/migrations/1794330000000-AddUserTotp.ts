import { type MigrationInterface, type QueryRunner } from 'typeorm'

/**
 * 用户两步验证（TOTP）字段
 *
 * - `totp_secret`：base32 密钥，setup 时写入、activate 成功后生效、deactivate 清空。
 *   实体侧声明 `select: false` —— 任何列表/详情接口都不会把它带出去，只有显式 addSelect
 *   的认证链路（登录门禁 / TotpService）能读到。
 * - `totp_enabled`：1 开 / 0 关。开着的账号登录必须带 6 位动态码（biz code 2105/2106）。
 *
 * 不建独立表：一个用户最多一个 TOTP 密钥，挂在 sys_user 上读写都少一次 JOIN。
 */
export class AddUserTotp1794330000000 implements MigrationInterface {
  name = 'AddUserTotp1794330000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE `sys_user` ADD COLUMN `totp_secret` VARCHAR(64) NULL COMMENT 'TOTP 密钥(base32, 两步验证)', ADD COLUMN `totp_enabled` TINYINT NOT NULL DEFAULT 0 COMMENT '两步验证(1开 0关)'"
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `sys_user` DROP COLUMN `totp_enabled`, DROP COLUMN `totp_secret`')
  }
}
