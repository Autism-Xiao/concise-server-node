import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 数据字典：dict_type / dict_item（自增 int 主键、自造字段）
 * → sys_dict / sys_dict_item（历史表名与字段）
 *
 * 字段映射：
 * - dict_type.name          → sys_dict.dict_name
 * - dict_type.code          → sys_dict.dict_code（唯一索引 uk_sd_dict_code）
 * - dict_type.remark        → sys_dict.description
 * - dict_type.created_at    → create_time，updated_at → update_time，补 create_by/del_flag/type/tenant_id
 * - dict_item.label         → sys_dict_item.item_text
 * - dict_item.value         → sys_dict_item.item_value
 * - dict_item.dict_type_id  → sys_dict_item.dict_id（关联 sys_dict.id）
 * - dict_item.sort          → sys_dict_item.sort_order
 * - dict_item.status(0/1)   → sys_dict_item.status(1启用 0不启用)，语义一致直接搬运
 *
 * 主键映射：dict_type.id=1 → 'dict_1'；dict_item.id=5 → 'dict_item_5'，便于存量数据一一对应。
 * 迁移完成后 drop 旧表（先删子表再删主表，避免外键阻塞）。
 */
export class Migration1793791381916 implements MigrationInterface {
  name = 'Migration1793791381916'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`sys_dict\` (
        \`id\` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '主键id',
        \`dict_name\` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '字典名称',
        \`dict_code\` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '字典编码（唯一）',
        \`description\` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '描述',
        \`del_flag\` int NOT NULL DEFAULT '0' COMMENT '删除状态（0正常 1已删除）',
        \`type\` int NOT NULL DEFAULT '0' COMMENT '字典类型（0 string / 1 number）',
        \`create_by\` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '创建人',
        \`create_time\` datetime DEFAULT NULL COMMENT '创建时间',
        \`update_by\` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '更新人',
        \`update_time\` datetime DEFAULT NULL COMMENT '更新时间',
        \`tenant_id\` int NOT NULL DEFAULT '0' COMMENT '租户ID',
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_sd_dict_code\` (\`dict_code\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='数据字典表'
    `)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`sys_dict_item\` (
        \`id\` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '主键id',
        \`dict_id\` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '字典id（sys_dict.id）',
        \`item_text\` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '字典项文本',
        \`item_value\` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '字典项值',
        \`description\` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '描述',
        \`sort_order\` int DEFAULT '0' COMMENT '排序',
        \`status\` int NOT NULL DEFAULT '1' COMMENT '状态（1启用 0不启用）',
        \`create_by\` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '创建人',
        \`create_time\` datetime DEFAULT NULL COMMENT '创建时间',
        \`update_by\` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '更新人',
        \`update_time\` datetime DEFAULT NULL COMMENT '更新时间',
        \`tenant_id\` int NOT NULL DEFAULT '0' COMMENT '租户ID',
        PRIMARY KEY (\`id\`),
        KEY \`idx_sdi_dict_id\` (\`dict_id\`),
        KEY \`idx_sdi_sort_order\` (\`sort_order\`),
        KEY \`idx_sdi_status\` (\`status\`),
        KEY \`idx_sdi_dict_value\` (\`dict_id\`, \`item_value\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='数据字典条目表'
    `)

    // 旧表存在才迁数据（全新环境没有 dict_type 时直接跳过）
    const legacy = (await queryRunner.query(
      `SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'dict_type'`
    )) as { c: number | string }[]

    if (Number(legacy[0]?.c ?? 0) > 0) {
      await queryRunner.query(`
        INSERT INTO \`sys_dict\` (id, dict_name, dict_code, description, del_flag, type, create_by, create_time, update_by, update_time, tenant_id)
        SELECT CONCAT('dict_', t.id), t.name, t.code, t.remark, 0, 0, 'migrate', t.created_at, NULL, t.updated_at, 0
        FROM \`dict_type\` t
        WHERE NOT EXISTS (SELECT 1 FROM \`sys_dict\` d WHERE d.dict_code = t.code)
      `)

      const hasItem = (await queryRunner.query(
        `SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'dict_item'`
      )) as { c: number | string }[]

      if (Number(hasItem[0]?.c ?? 0) > 0) {
        await queryRunner.query(`
          INSERT INTO \`sys_dict_item\` (id, dict_id, item_text, item_value, description, sort_order, status, create_by, create_time, update_by, update_time, tenant_id)
          SELECT CONCAT('dict_item_', i.id), CONCAT('dict_', i.dict_type_id), i.label, i.value, i.remark, i.sort, i.status, 'migrate', i.created_at, NULL, i.updated_at, 0
          FROM \`dict_item\` i
          WHERE EXISTS (SELECT 1 FROM \`sys_dict\` d WHERE d.id = CONCAT('dict_', i.dict_type_id))
            AND NOT EXISTS (SELECT 1 FROM \`sys_dict_item\` si WHERE si.id = CONCAT('dict_item_', i.id))
        `)
        await queryRunner.query('DROP TABLE IF EXISTS `dict_item`')
      }

      await queryRunner.query('DROP TABLE IF EXISTS `dict_type`')
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`dict_type\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`name\` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '字典类型名称',
        \`code\` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '字典编码',
        \`status\` tinyint NOT NULL DEFAULT '1' COMMENT '状态：0禁用 1启用',
        \`remark\` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '备注',
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`IDX_f6be8ac6002aa6726440ace44c\` (\`code\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`dict_item\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`label\` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '字典标签',
        \`value\` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '字典值',
        \`dict_type_id\` int NOT NULL,
        \`sort\` int NOT NULL DEFAULT '0' COMMENT '排序号',
        \`status\` tinyint NOT NULL DEFAULT '1' COMMENT '状态：0禁用 1启用',
        \`remark\` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '备注',
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
        PRIMARY KEY (\`id\`),
        KEY \`FK_458bccd9a996c3209daa4c3d206\` (\`dict_type_id\`),
        CONSTRAINT \`FK_458bccd9a996c3209daa4c3d206\` FOREIGN KEY (\`dict_type_id\`) REFERENCES \`dict_type\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)

    await queryRunner.query('DROP TABLE IF EXISTS `sys_dict_item`')
    await queryRunner.query('DROP TABLE IF EXISTS `sys_dict`')
  }
}
