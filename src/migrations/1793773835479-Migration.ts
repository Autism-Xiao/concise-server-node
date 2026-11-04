import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * login_log 增加 browser / os / location 三列：
 * 登录日志从「原始 UA 串」升级为「解析后的浏览器、操作系统、IP 归属地」，
 * 由 LogService.recordLogin 写入时统一解析（原料仍是 ip + userAgent）。
 * 存量行置 NULL，前端展示为「未知」。
 */
export class Migration1793773835479 implements MigrationInterface {
  name = 'Migration1793773835479'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TABLE `login_log` ADD COLUMN `browser` varchar(64) NULL COMMENT '浏览器（UA解析）'")
    await queryRunner.query("ALTER TABLE `login_log` ADD COLUMN `os` varchar(64) NULL COMMENT '操作系统（UA解析）'")
    await queryRunner.query("ALTER TABLE `login_log` ADD COLUMN `location` varchar(128) NULL COMMENT 'IP归属地（ip2region）'")
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `login_log` DROP COLUMN `location`')
    await queryRunner.query('ALTER TABLE `login_log` DROP COLUMN `os`')
    await queryRunner.query('ALTER TABLE `login_log` DROP COLUMN `browser`')
  }
}
