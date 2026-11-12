import { type MigrationInterface, type QueryRunner } from 'typeorm'

/**
 * 修正 task.assignee_id 类型：int → varchar(32)，对齐 sys_user.id（32 位字符串主键）
 *
 * 背景：task 表按 int 用户 ID 设计，但本项目用户主键是 32 位字符串。
 * 结果是「指派给某用户」永远匹配不上，首页概览「我的待办」只能恒等
 * 于「未指派任务数」（assignee_id = 0 兜底统计）。这里把列改成与
 * sys_user.id 同型，历史 int 值本就对应不上任何现存用户，统一归 '0'（未指派）。
 */
export class FixTaskAssigneeType1794190000000 implements MigrationInterface {
  name = 'FixTaskAssigneeType1794190000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 历史 int 值对应不上任何现存用户，连同 NULL 一起归零，再改 NOT NULL
    await queryRunner.query('UPDATE `task` SET `assignee_id` = 0 WHERE `assignee_id` IS NULL OR `assignee_id` <> 0')
    await queryRunner.query("ALTER TABLE `task` MODIFY COLUMN `assignee_id` VARCHAR(32) NOT NULL DEFAULT '0' COMMENT '负责人用户ID，0为未指派'")
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 回滚只能保 int 能装下的值：字符串主键一律归 0
    await queryRunner.query('UPDATE `task` SET `assignee_id` = 0 WHERE `assignee_id` NOT REGEXP "^[0-9]+$"')
    await queryRunner.query("ALTER TABLE `task` MODIFY COLUMN `assignee_id` INT NOT NULL DEFAULT 0 COMMENT '负责人用户ID，0为未指派'")
  }
}
