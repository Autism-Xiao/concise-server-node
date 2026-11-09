import { type MigrationInterface, type QueryRunner } from 'typeorm'

/**
 * 水印全局策略下沉到租户级
 *
 * 背景：sys_watermark_setting 原来是单行表（id 恒为 1），多租户下任何租户管理员
 * 改水印都等于改全平台 —— 跨租户越权。
 *
 * 新结构：主键 `tenant_id`
 * - `tenant_id = 0` 平台默认（兜底，所有租户继承）
 * - `tenant_id > 0` 该租户自己的策略
 *
 * 迁移动作：原来那一行（id=1）保留为默认租户(1)的配置，同时复制一份到 tenant_id=0 作平台默认，
 * 这样默认租户行为不变、其它租户拿到同样的初始值（而不是被静默改文案）。
 */
export class WatermarkTenantScope1794290000000 implements MigrationInterface {
  name = 'WatermarkTenantScope1794290000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 已经是新结构（有 tenant_id）就只补平台默认行
    if (!(await this.hasColumn(queryRunner, 'sys_watermark_setting', 'tenant_id'))) {
      await queryRunner.query('ALTER TABLE `sys_watermark_setting` DROP PRIMARY KEY')
      if (await this.hasColumn(queryRunner, 'sys_watermark_setting', 'id')) {
        await queryRunner.query('ALTER TABLE `sys_watermark_setting` DROP COLUMN `id`')
      }
      await queryRunner.query("ALTER TABLE `sys_watermark_setting` ADD COLUMN `tenant_id` INT NOT NULL DEFAULT 1 COMMENT '租户ID(0=平台默认)' FIRST")
      await queryRunner.query('ALTER TABLE `sys_watermark_setting` ADD PRIMARY KEY (`tenant_id`)')
    }

    // 平台默认行：从默认租户复制一份（表为空则由服务端兜底常量兜住）
    const platform: Array<{ c: number | string }> = await queryRunner.query('SELECT COUNT(*) AS c FROM `sys_watermark_setting` WHERE `tenant_id` = 0')
    if (Number(platform[0]?.c ?? 0) === 0) {
      await queryRunner.query(
        `INSERT INTO \`sys_watermark_setting\`
           (\`tenant_id\`, \`enabled\`, \`mode\`, \`content\`, \`density\`, \`opacity\`, \`rotate\`, \`font_size\`, \`updated_by\`, \`updated_at\`)
         SELECT 0, \`enabled\`, \`mode\`, \`content\`, \`density\`, \`opacity\`, \`rotate\`, \`font_size\`, \`updated_by\`, \`updated_at\`
           FROM \`sys_watermark_setting\` WHERE \`tenant_id\` = 1`
      )
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await this.hasColumn(queryRunner, 'sys_watermark_setting', 'tenant_id'))) return
    // 回滚成单行表：只保留一份配置（优先租户 1，其次平台默认）
    await queryRunner.query('CREATE TEMPORARY TABLE `tmp_wm_keep` AS SELECT `tenant_id` FROM `sys_watermark_setting` ORDER BY `tenant_id` DESC LIMIT 1')
    await queryRunner.query('DELETE FROM `sys_watermark_setting` WHERE `tenant_id` <> (SELECT `tenant_id` FROM `tmp_wm_keep`)')
    await queryRunner.query('DROP TEMPORARY TABLE `tmp_wm_keep`')
    await queryRunner.query('ALTER TABLE `sys_watermark_setting` DROP PRIMARY KEY')
    await queryRunner.query('ALTER TABLE `sys_watermark_setting` ADD COLUMN `id` TINYINT NOT NULL DEFAULT 1 FIRST')
    await queryRunner.query('ALTER TABLE `sys_watermark_setting` ADD PRIMARY KEY (`id`)')
    await queryRunner.query('ALTER TABLE `sys_watermark_setting` DROP COLUMN `tenant_id`')
  }

  private async hasColumn(queryRunner: QueryRunner, table: string, column: string): Promise<boolean> {
    const rows: Array<{ c: number | string }> = await queryRunner.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column]
    )
    return Number(rows[0]?.c ?? 0) > 0
  }
}
