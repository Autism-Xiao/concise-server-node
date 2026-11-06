import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 日历管理模块三张表：
 * - base_calendar                日历分类（个人日历本，颜色标识）
 * - base_schedule_event          日程事件（含提醒字段 remind_at / is_reminded）
 * - base_schedule_reminder_log   站内提醒消息记录（未读/已读）
 *
 * 设计要点：
 * - 触发幂等：base_schedule_event.is_reminded 抢权式 UPDATE（WHERE is_reminded=0）
 * - 消息防重：reminder_log UNIQUE(event_id, user_id)
 * - 巡逻索引：idx_event_remind (remind_at, is_reminded)
 */
export class CreateScheduleTables1794100000000 implements MigrationInterface {
  name = 'CreateScheduleTables1794100000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`base_calendar\` (
        \`id\` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键',
        \`name\` VARCHAR(50) NOT NULL COMMENT '日历名称',
        \`color\` VARCHAR(20) NOT NULL DEFAULT '#1890ff' COMMENT '颜色标识',
        \`owner_id\` VARCHAR(32) NOT NULL COMMENT '属主用户ID',
        \`is_public\` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否公开(公开日历事件全员可见)',
        \`create_time\` DATETIME NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        \`update_time\` DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        PRIMARY KEY (\`id\`),
        KEY \`idx_calendar_owner\` (\`owner_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='日历分类'
    `)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`base_schedule_event\` (
        \`id\` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键',
        \`calendar_id\` BIGINT NOT NULL COMMENT '所属日历ID',
        \`user_id\` VARCHAR(32) NOT NULL COMMENT '创建者用户ID(提醒接收人)',
        \`title\` VARCHAR(200) NOT NULL COMMENT '日程标题',
        \`start_time\` DATETIME NOT NULL COMMENT '开始时间',
        \`end_time\` DATETIME NOT NULL COMMENT '结束时间',
        \`description\` VARCHAR(1000) NULL COMMENT '描述',
        \`category\` VARCHAR(50) NULL COMMENT '标签: 会议/待办/维护等',
        \`remind_type\` VARCHAR(20) NOT NULL DEFAULT 'SOCKET' COMMENT '提醒方式(当前仅 SOCKET=站内消息)',
        \`remind_at\` DATETIME NULL COMMENT '提醒触发时间点(空=不提醒)',
        \`is_reminded\` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否已提醒(幂等标记)',
        \`create_time\` DATETIME NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
        \`update_time\` DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
        PRIMARY KEY (\`id\`),
        KEY \`idx_event_user_start\` (\`user_id\`, \`start_time\`),
        KEY \`idx_event_remind\` (\`remind_at\`, \`is_reminded\`),
        KEY \`idx_event_calendar\` (\`calendar_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='日程事件'
    `)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`base_schedule_reminder_log\` (
        \`id\` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键',
        \`event_id\` BIGINT NOT NULL COMMENT '来源日程ID',
        \`user_id\` VARCHAR(32) NOT NULL COMMENT '接收用户ID',
        \`title\` VARCHAR(200) NOT NULL COMMENT '消息标题(日程标题)',
        \`message\` VARCHAR(1000) NULL COMMENT '消息内容',
        \`is_read\` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否已读',
        \`read_at\` DATETIME NULL COMMENT '已读时间',
        \`create_time\` DATETIME NULL DEFAULT CURRENT_TIMESTAMP COMMENT '推送时间',
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_log_event_user\` (\`event_id\`, \`user_id\`),
        KEY \`idx_log_user_read\` (\`user_id\`, \`is_read\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='站内提醒消息记录'
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `base_schedule_reminder_log`')
    await queryRunner.query('DROP TABLE IF EXISTS `base_schedule_event`')
    await queryRunner.query('DROP TABLE IF EXISTS `base_calendar`')
  }
}
