import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * tool_storage 归属留痕：新增 tenant_id（0=平台共享/历史数据）。
 *
 * 旧上传链路（/v1/upload）的图片是公开静态直出的，但记录里只有 user_id，
 * 无法回答「这张图属于哪个租户」。加列只为归属留痕与后续按租户清理/鉴权下载，
 * **不改变当前静态直出的行为**（头像/富文本插图仍走 <img src=/upload/...>）。
 *
 * 历史行统一留 0，不做猜测回填：user_id 跨租户通用，反推会误标。
 */
export class AddStorageTenant1794960000000 implements MigrationInterface {
  name = 'AddStorageTenant1794960000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    const columns = (await queryRunner.query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tool_storage' AND COLUMN_NAME = 'tenant_id'"
    )) as unknown[]
    if (columns.length === 0) {
      await queryRunner.query("ALTER TABLE `tool_storage` ADD COLUMN `tenant_id` int NOT NULL DEFAULT 0 COMMENT '租户ID(0=平台共享)'")
      await queryRunner.query('CREATE INDEX `idx_tool_storage_tenant` ON `tool_storage` (`tenant_id`)')
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const columns = (await queryRunner.query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tool_storage' AND COLUMN_NAME = 'tenant_id'"
    )) as unknown[]
    if (columns.length > 0) {
      await queryRunner.query('DROP INDEX `idx_tool_storage_tenant` ON `tool_storage`')
      await queryRunner.query('ALTER TABLE `tool_storage` DROP COLUMN `tenant_id`')
    }
  }
}
