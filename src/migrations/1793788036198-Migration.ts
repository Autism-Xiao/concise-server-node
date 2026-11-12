import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 通知公告表：notice（自增 int 主键、自造字段）→ sys_announcement
 *
 * 字段映射（原表结构）：
 * - id            int auto_increment → varchar(32) 32 位字符串
 * - title         → titile（历史表列名就是这个拼写，保留不改）
 * - content       → msg_content
 * - type(1通知2公告) → msg_category 统一取 '1'（通知公告）；msg_type 取 'ALL'（全体用户）
 * - status(0草稿1已发布) → send_status('0'未发布 / '1'已发布)
 * - published_at  → send_time
 * - 新增列：priority / start_time / end_time / sender / cancel_time / user_ids
 * - created_at/updated_at → create_time/update_time，并补 create_by/update_by/del_flag
 *
 * 存量数据迁移完成后 drop 旧表 notice。
 */
export class Migration1793788036198 implements MigrationInterface {
  name = 'Migration1793788036198'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`sys_announcement\` (
        \`id\` varchar(32) NOT NULL COMMENT '主键id',
        \`titile\` varchar(100) NOT NULL COMMENT '标题（历史表列名拼写）',
        \`msg_content\` text NULL COMMENT '内容',
        \`msg_category\` varchar(10) NOT NULL DEFAULT '1' COMMENT '消息类型（1通知公告 2系统消息）',
        \`msg_type\` varchar(10) NULL COMMENT '通告对象类型（USER指定用户 ALL全体用户）',
        \`priority\` varchar(255) NULL COMMENT '优先级（L低 M中 H高）',
        \`send_status\` varchar(10) NOT NULL DEFAULT '0' COMMENT '发布状态（0未发布 1已发布 2已撤销）',
        \`sender\` varchar(100) NULL COMMENT '发布人',
        \`send_time\` datetime NULL COMMENT '发布时间',
        \`cancel_time\` datetime NULL COMMENT '撤销时间',
        \`start_time\` datetime NULL COMMENT '开始时间',
        \`end_time\` datetime NULL COMMENT '结束时间',
        \`user_ids\` text NULL COMMENT '指定用户',
        \`del_flag\` varchar(1) NOT NULL DEFAULT '0' COMMENT '删除状态（0正常 1已删除）',
        \`create_by\` varchar(32) NULL COMMENT '创建人',
        \`create_time\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        \`update_by\` varchar(32) NULL COMMENT '更新人',
        \`update_time\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        PRIMARY KEY (\`id\`),
        KEY \`idx_sys_announcement_status\` (\`send_status\`, \`send_time\`),
        KEY \`idx_sys_announcement_category\` (\`msg_category\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统通告表'
    `)

    // 迁移存量公告（若旧表还在）：状态 1已发布/0草稿 → 新表 '1'已发布/'0'未发布
    if (await queryRunner.hasTable('notice')) {
      await queryRunner.query(`
        INSERT INTO \`sys_announcement\` (
          \`id\`, \`titile\`, \`msg_content\`, \`msg_category\`, \`msg_type\`, \`priority\`,
          \`send_status\`, \`sender\`, \`send_time\`, \`del_flag\`,
          \`create_by\`, \`create_time\`, \`update_by\`, \`update_time\`
        )
        SELECT
          REPLACE(UUID(), '-', ''),
          \`title\`,
          \`content\`,
          '1',
          'ALL',
          'M',
          CASE WHEN \`status\` = 1 THEN '1' ELSE '0' END,
          'admin',
          \`published_at\`,
          '0',
          'admin',
          \`created_at\`,
          NULL,
          \`updated_at\`
        FROM \`notice\`
      `)
      await queryRunner.query('DROP TABLE IF EXISTS `notice`')
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 回滚不还原旧 notice 表结构（存量数据已按新表语义转换，反向映射会丢优先级/通告对象等列）
    await queryRunner.query('DROP TABLE IF EXISTS `sys_announcement`')
  }
}
