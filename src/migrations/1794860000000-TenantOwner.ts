import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 租户开通人（VIP 额度统计口径）
 *
 * 为什么不能直接数 sys_user_tenant：任何账号被加入某个租户都算一条归属，
 * 把「被邀请加入」当成「自己开通的团队」会让 VIP 额度瞬间被别人的团队吃掉。
 * 只有自助开通（POST /v1/tenants/apply）才写 owner_user_id，平台代开保持 NULL 不占个人额度。
 *
 * 回滚：删索引与列。已开通的租户归属不受影响（只丢「是谁开的」这个统计信息）。
 */
export class TenantOwner1794860000000 implements MigrationInterface {
  name = 'TenantOwner1794860000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TABLE `sys_tenant` ADD COLUMN `owner_user_id` varchar(32) NULL COMMENT '开通人(自助开通)' AFTER `code`")
    await queryRunner.query('ALTER TABLE `sys_tenant` ADD INDEX `idx_tenant_owner` (`owner_user_id`)')
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `sys_tenant` DROP INDEX `idx_tenant_owner`')
    await queryRunner.query('ALTER TABLE `sys_tenant` DROP COLUMN `owner_user_id`')
  }
}
