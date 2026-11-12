import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 新建职级表 sys_level 与岗位表 sys_position：
 * - 职级：无对应原表，按同风格自建（32 位字符串主键、tenant_id、审计四列）
 * - 岗位：sys_position，补充 dept_id（所属部门）与 status
 */
export class Migration1793785118314 implements MigrationInterface {
  name = 'Migration1793785118314'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`sys_level\` (
        \`id\` varchar(32) NOT NULL COMMENT '主键id',
        \`level_name\` varchar(100) NOT NULL COMMENT '职级名称（如 P6 / M1）',
        \`level_rank\` int NOT NULL DEFAULT 0 COMMENT '等级数值，数字越大级别越高',
        \`status\` varchar(1) NOT NULL DEFAULT '1' COMMENT '状态（1正常，0停用）',
        \`remark\` varchar(500) NULL COMMENT '备注',
        \`create_by\` varchar(32) NULL COMMENT '创建人',
        \`create_time\` datetime NULL COMMENT '创建时间',
        \`update_by\` varchar(32) NULL COMMENT '更新人',
        \`update_time\` datetime NULL COMMENT '更新时间',
        \`tenant_id\` int NOT NULL DEFAULT 0 COMMENT '租户ID',
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_sys_level_name\` (\`level_name\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='职级表'
    `)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`sys_position\` (
        \`id\` varchar(32) NOT NULL COMMENT '主键id',
        \`post_code\` varchar(100) NOT NULL COMMENT '岗位编码',
        \`post_name\` varchar(100) NOT NULL COMMENT '岗位名称',
        \`post_sort\` int NOT NULL DEFAULT 0 COMMENT '排序',
        \`dept_id\` varchar(32) NULL COMMENT '所属部门ID（sys_depart.id）',
        \`status\` varchar(1) NOT NULL DEFAULT '1' COMMENT '状态（1正常，0停用）',
        \`description\` varchar(500) NULL COMMENT '描述',
        \`create_by\` varchar(32) NULL COMMENT '创建人',
        \`create_time\` datetime NULL COMMENT '创建时间',
        \`update_by\` varchar(32) NULL COMMENT '更新人',
        \`update_time\` datetime NULL COMMENT '更新时间',
        \`tenant_id\` int NOT NULL DEFAULT 0 COMMENT '租户ID',
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_sys_position_code\` (\`post_code\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='岗位表'
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `sys_position`')
    await queryRunner.query('DROP TABLE IF EXISTS `sys_level`')
  }
}
