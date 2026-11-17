import type { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 租户列默认值统一为 0（平台共享）+ 修正被错归的历史公告
 *
 * 背景：单租户时代多张业务表的 tenant_id 列默认值是 1（「默认租户」）。
 * 多租户化后语义反转：tenant_id = 0 才是平台共享数据，>0 归属具体租户。
 * 而 BaseService.stampTenant 此前在平台视角（tenantId=null）不打标，
 * 落库走列默认值 → 超管在平台视角创建的公告等数据被错归到租户 1，
 * 其他租户全部看不见（如「系统 V1.0 上线」这类平台公告）。
 *
 * 本次三件事：
 * 1. 9 张表的 tenant_id 列默认值统一改为 0（配合 stampTenant 改为平台视角显式打 0，
 *    双保险，即使某条写路径绕过打标也不会错归租户）；
 * 2. 修正 sys_announcement 里 create_by='admin' 的历史行（平台超管在平台视角创建，
 *    被列默认值错归到租户 1）→ tenant_id = 0。只修公告表：公告的语义就是
 *    「发给全平台」，错归影响所有租户可见性；customer/task/message 等表的
 *    tenant_id=1 历史行无法区分「平台视角意外落库」还是「超管切租户视角创建」，
 *    保持现状，后续发现再逐行人工判定。
 * 3. down 只还原列默认值，不回滚数据修正（数据语义修正不可逆还原）。
 */
export class TenantColumnDefaults1794830000000 implements MigrationInterface {
  /** 列默认值为 1 的业务表（information_schema 查证，2026-11-17） */
  private static readonly TABLES = [
    'biz_order',
    'customer',
    'supplier',
    'sys_announcement',
    'sys_file',
    'sys_log',
    'sys_message',
    'sys_watermark_setting',
    'task'
  ]

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of TenantColumnDefaults1794830000000.TABLES) {
      await queryRunner.query(`ALTER TABLE \`${table}\` ALTER COLUMN \`tenant_id\` SET DEFAULT 0`)
    }
    // 历史公告修正：admin（平台超管）创建的行被列默认值错归租户 1，还原为平台共享
    await queryRunner.query(`UPDATE \`sys_announcement\` SET \`tenant_id\` = 0 WHERE \`tenant_id\` = 1 AND \`create_by\` = 'admin'`)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of TenantColumnDefaults1794830000000.TABLES) {
      await queryRunner.query(`ALTER TABLE \`${table}\` ALTER COLUMN \`tenant_id\` SET DEFAULT 1`)
    }
  }
}
