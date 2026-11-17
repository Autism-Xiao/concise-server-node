import { type MigrationInterface, type QueryRunner } from 'typeorm'

/**
 * 租户业务表的唯一键补上租户维度（对齐 sys_role 的 (tenant_id, role_code) 先例）
 *
 * 之前 4 张带 tenant_id 的表仍然是**全局列级唯一**，这正是多租户方案里
 * 「唯一索引必须包含 tenant_id」要防的坑：租户 B 永远建不了与租户 A /
 * 平台内置同编码的数据，软删行还会永久占用编码。
 *
 * 改为联合唯一后，编码唯一性的口径变成（与各 Service 的查重逻辑一致）：
 * - 租户视角：`本租户 ∪ 平台共享(tenant_id=0)` 行内唯一 —— 租户之间可重码，
 *   但不允许与平台内置编码冲突（避免字典/部门编码在运行时取值产生歧义）
 * - 平台视角（tenantId=null）：全局唯一（生成编码时会全局查重）
 *
 * 数据安全：原全局唯一键比联合唯一**更严**，存量数据不可能违反新约束，
 * 直接加联合唯一不会失败。
 */
export class TenantUniqueKeys17948200000000 implements MigrationInterface {
  name = 'TenantUniqueKeys17948200000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 字典编码：uk_sd_dict_code (dict_code) → (tenant_id, dict_code)
    if (await this.hasIndex(queryRunner, 'sys_dict', 'uk_sd_dict_code')) {
      await queryRunner.query('ALTER TABLE `sys_dict` DROP INDEX `uk_sd_dict_code`')
    }
    if (!(await this.hasIndex(queryRunner, 'sys_dict', 'uniq_sys_dict_tenant_code'))) {
      await queryRunner.query('ALTER TABLE `sys_dict` ADD UNIQUE KEY `uniq_sys_dict_tenant_code` (`tenant_id`, `dict_code`)')
    }

    // 岗位编码：uk_sys_position_code (post_code) → (tenant_id, post_code)
    if (await this.hasIndex(queryRunner, 'sys_position', 'uk_sys_position_code')) {
      await queryRunner.query('ALTER TABLE `sys_position` DROP INDEX `uk_sys_position_code`')
    }
    if (!(await this.hasIndex(queryRunner, 'sys_position', 'uniq_sys_position_tenant_code'))) {
      await queryRunner.query('ALTER TABLE `sys_position` ADD UNIQUE KEY `uniq_sys_position_tenant_code` (`tenant_id`, `post_code`)')
    }

    // 职级名称：uk_sys_level_name (level_name) → (tenant_id, level_name)
    if (await this.hasIndex(queryRunner, 'sys_level', 'uk_sys_level_name')) {
      await queryRunner.query('ALTER TABLE `sys_level` DROP INDEX `uk_sys_level_name`')
    }
    if (!(await this.hasIndex(queryRunner, 'sys_level', 'uniq_sys_level_tenant_name'))) {
      await queryRunner.query('ALTER TABLE `sys_level` ADD UNIQUE KEY `uniq_sys_level_tenant_name` (`tenant_id`, `level_name`)')
    }

    // 机构编码：uniq_depart_org_code (org_code) → (tenant_id, org_code)
    if (await this.hasIndex(queryRunner, 'sys_depart', 'uniq_depart_org_code')) {
      await queryRunner.query('ALTER TABLE `sys_depart` DROP INDEX `uniq_depart_org_code`')
    }
    if (!(await this.hasIndex(queryRunner, 'sys_depart', 'uniq_depart_tenant_org_code'))) {
      await queryRunner.query('ALTER TABLE `sys_depart` ADD UNIQUE KEY `uniq_depart_tenant_org_code` (`tenant_id`, `org_code`)')
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 回滚要求各表内无跨租户重码；上线后若已产生租户间重码，需先人工处理数据
    if (await this.hasIndex(queryRunner, 'sys_dict', 'uniq_sys_dict_tenant_code')) {
      await queryRunner.query('ALTER TABLE `sys_dict` DROP INDEX `uniq_sys_dict_tenant_code`')
    }
    if (!(await this.hasIndex(queryRunner, 'sys_dict', 'uk_sd_dict_code'))) {
      await queryRunner.query('ALTER TABLE `sys_dict` ADD UNIQUE KEY `uk_sd_dict_code` (`dict_code`)')
    }

    if (await this.hasIndex(queryRunner, 'sys_position', 'uniq_sys_position_tenant_code')) {
      await queryRunner.query('ALTER TABLE `sys_position` DROP INDEX `uniq_sys_position_tenant_code`')
    }
    if (!(await this.hasIndex(queryRunner, 'sys_position', 'uk_sys_position_code'))) {
      await queryRunner.query('ALTER TABLE `sys_position` ADD UNIQUE KEY `uk_sys_position_code` (`post_code`)')
    }

    if (await this.hasIndex(queryRunner, 'sys_level', 'uniq_sys_level_tenant_name')) {
      await queryRunner.query('ALTER TABLE `sys_level` DROP INDEX `uniq_sys_level_tenant_name`')
    }
    if (!(await this.hasIndex(queryRunner, 'sys_level', 'uk_sys_level_name'))) {
      await queryRunner.query('ALTER TABLE `sys_level` ADD UNIQUE KEY `uk_sys_level_name` (`level_name`)')
    }

    if (await this.hasIndex(queryRunner, 'sys_depart', 'uniq_depart_tenant_org_code')) {
      await queryRunner.query('ALTER TABLE `sys_depart` DROP INDEX `uniq_depart_tenant_org_code`')
    }
    if (!(await this.hasIndex(queryRunner, 'sys_depart', 'uniq_depart_org_code'))) {
      await queryRunner.query('ALTER TABLE `sys_depart` ADD UNIQUE KEY `uniq_depart_org_code` (`org_code`)')
    }
  }

  private async hasIndex(queryRunner: QueryRunner, table: string, index: string): Promise<boolean> {
    const rows: Array<{ c: number | string }> = await queryRunner.query(
      `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
      [table, index]
    )
    return Number(rows[0]?.c ?? 0) > 0
  }
}
