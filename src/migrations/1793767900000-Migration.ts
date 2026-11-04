import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 用户-部门改多对多（对齐 JeecgBoot sys_user_depart）
 *
 * 背景：此前 sys_user.dept_id 是「单部门」扩展列，JeecgBoot 原生用中间表 sys_user_depart，
 * 一个用户可挂多个部门；主部门（depart_ids 第一个）的机构编码冗余到 sys_user.org_code 供数据权限过滤。
 *
 * 表结构完全照搬 JeecgBoot：ID varchar(32) 主键（DB 默认 replace(uuid(),'-','') 生成，TypeORM
 * 多对多插入只写 user_id / dep_id 也不会失败）、user_id+dep_id 唯一键。
 *
 * up  ：建表 → 把存量 dept_id 搬进关联表 → 回填 depart_ids / org_code → 删除 dept_id 列
 * down：加回 dept_id → 用 depart_ids 首个部门回填 → 删除关联表
 */
export class Migration1793767900000 implements MigrationInterface {
  name = 'Migration1793767900000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS \`sys_user_depart\` (
      \`ID\` varchar(32) NOT NULL DEFAULT (replace(uuid(),'-','')) COMMENT 'id',
      \`user_id\` varchar(32) DEFAULT NULL COMMENT '用户id',
      \`dep_id\` varchar(32) DEFAULT NULL COMMENT '部门id',
      PRIMARY KEY (\`ID\`),
      UNIQUE KEY \`idx_sud_user_dep_id\` (\`user_id\`,\`dep_id\`),
      KEY \`idx_sud_user_id\` (\`user_id\`),
      KEY \`idx_sud_dep_id\` (\`dep_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户-部门关系表'`)

    // 存量单部门数据搬到关联表（重复执行安全）
    await queryRunner.query(`INSERT IGNORE INTO \`sys_user_depart\` (\`user_id\`, \`dep_id\`)
      SELECT u.\`id\`, u.\`dept_id\` FROM \`sys_user\` u
      WHERE u.\`dept_id\` IS NOT NULL AND u.\`dept_id\` <> ''`)

    // 回填部门集合与机构编码冗余（只有本次搬过来的用户需要）
    await queryRunner.query(`UPDATE \`sys_user\` u
      JOIN \`sys_user_depart\` ud ON ud.\`user_id\` = u.\`id\`
      LEFT JOIN \`sys_depart\` d ON d.\`id\` = ud.\`dep_id\`
      SET u.\`depart_ids\` = ud.\`dep_id\`, u.\`org_code\` = d.\`org_code\`
      WHERE u.\`dept_id\` IS NOT NULL AND u.\`dept_id\` <> ''`)

    // 旧列已无意义，删掉避免「双份真相」
    await queryRunner.query('ALTER TABLE `sys_user` DROP COLUMN `dept_id`')
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TABLE `sys_user` ADD COLUMN `dept_id` varchar(32) DEFAULT NULL COMMENT '所属部门ID（旧版单部门列，已废弃）'")
    await queryRunner.query(`UPDATE \`sys_user\` SET \`dept_id\` = SUBSTRING_INDEX(\`depart_ids\`, ',', 1)
      WHERE \`depart_ids\` IS NOT NULL AND \`depart_ids\` <> ''`)
    await queryRunner.query('DROP TABLE IF EXISTS `sys_user_depart`')
  }
}
