import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 多租户深化审计的收口迁移（三项）：
 *
 * 1. `sys_quartz_job.tenant_id`：定时任务归属租户。
 *    0 = 平台级任务（执行时保持平台视角，不过滤）；> 0 = 该租户的任务，执行时由
 *    JobScheduler 注入租户上下文。没有这一列时任务里查业务表是**全租户**读写。
 *
 * 2. `sys_dict_item` 的 `(dict_id, item_value)` 唯一索引。原来只有普通索引，
 *    唯一性全靠 Service 的「先查再插」，并发/重复导入会插出两条同值项。
 *    加索引前先按「同 dict + 同值保留 id 最小的一条」去重，避免 ADD UNIQUE 直接失败。
 *
 * 3. 预置平台级参数 `security.platformAdmin.require2fa`（默认 false）：
 *    开启后，未绑定 TOTP 的平台超管拿到的令牌会带 mfaPending 标记，所有平台级接口被拦，
 *    但不影响登录与绑定流程（避免死锁）。
 *
 * 回滚：删索引、删列、删参数行。
 */
export class MultitenantHardening1794930000000 implements MigrationInterface {
  name = 'MultitenantHardening1794930000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- 1. 定时任务归属租户 ----
    const jobTenantColumn = (await queryRunner.query("SHOW COLUMNS FROM `sys_quartz_job` LIKE 'tenant_id'")) as unknown[]
    if (jobTenantColumn.length === 0) {
      await queryRunner.query("ALTER TABLE `sys_quartz_job` ADD COLUMN `tenant_id` int NOT NULL DEFAULT 0 COMMENT '租户ID(0=平台级任务)' AFTER `id`")
      await queryRunner.query('ALTER TABLE `sys_quartz_job` ADD INDEX `idx_quartz_job_tenant` (`tenant_id`)')
    }

    // ---- 2. 字典项唯一索引（先去重）----
    const hasItemUnique = (await queryRunner.query("SHOW INDEX FROM `sys_dict_item` WHERE Key_name = 'uk_dict_item_value'")) as unknown[]
    if (hasItemUnique.length === 0) {
      await queryRunner.query(
        `DELETE dup FROM \`sys_dict_item\` dup
           JOIN \`sys_dict_item\` keep
             ON keep.dict_id = dup.dict_id
            AND keep.item_value = dup.item_value
            AND keep.id < dup.id`
      )
      await queryRunner.query('ALTER TABLE `sys_dict_item` ADD UNIQUE KEY `uk_dict_item_value` (`dict_id`, `item_value`)')
    }

    // ---- 3. 平台超管强制两步验证开关 ----
    await queryRunner.query(
      `INSERT IGNORE INTO sys_config (config_key, config_value, value_type, config_group, name, remark, is_builtin, allow_tenant, del_flag, created_at, updated_at)
       VALUES ('security.platformAdmin.require2fa', 'false', 'boolean', 'security', '平台管理员强制两步验证',
               '开启后未绑定 TOTP 的平台管理员可登录但无法执行平台级操作，需先完成绑定', 1, 0, 0, NOW(), NOW())`
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DELETE FROM `sys_config` WHERE `config_key` = 'security.platformAdmin.require2fa'")
    const hasItemUnique = (await queryRunner.query("SHOW INDEX FROM `sys_dict_item` WHERE Key_name = 'uk_dict_item_value'")) as unknown[]
    if (hasItemUnique.length > 0) {
      await queryRunner.query('ALTER TABLE `sys_dict_item` DROP INDEX `uk_dict_item_value`')
    }
    const jobTenantColumn = (await queryRunner.query("SHOW COLUMNS FROM `sys_quartz_job` LIKE 'tenant_id'")) as unknown[]
    if (jobTenantColumn.length > 0) {
      await queryRunner.query('ALTER TABLE `sys_quartz_job` DROP INDEX `idx_quartz_job_tenant`')
      await queryRunner.query('ALTER TABLE `sys_quartz_job` DROP COLUMN `tenant_id`')
    }
  }
}
