import type { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * user 表对齐 JeecgBoot sys_user：
 * 1. 补表注释「用户表」
 * 2. nickname → realname（真实姓名，与 sys_user 对齐）
 * 3. 新增 avatar/sex/phone/telephone/birthday/work_no/create_by/update_by/del_flag
 * 4. 种子数据按 sys_user 风格补齐（admin：管理员/工号00001/男）
 */
export class Migration1793763842271 implements MigrationInterface {
  name = 'Migration1793763842271'

  async up(queryRunner: QueryRunner): Promise<void> {
    // 表注释
    await queryRunner.query("ALTER TABLE `user` COMMENT='用户表（对齐 JeecgBoot sys_user）'")

    // nickname → realname，同步保留原数据
    await queryRunner.query("ALTER TABLE `user` CHANGE COLUMN `nickname` `realname` varchar(100) NOT NULL COMMENT '真实姓名'")

    // 新增字段（对齐 sys_user）
    await queryRunner.query("ALTER TABLE `user` ADD COLUMN `avatar` varchar(255) NULL COMMENT '头像' AFTER `realname`")
    await queryRunner.query("ALTER TABLE `user` ADD COLUMN `sex` tinyint NOT NULL DEFAULT 0 COMMENT '性别(0-默认未知,1-男,2-女)' AFTER `avatar`")
    await queryRunner.query("ALTER TABLE `user` ADD COLUMN `phone` varchar(45) NULL COMMENT '手机号' AFTER `sex`")
    await queryRunner.query("ALTER TABLE `user` ADD COLUMN `telephone` varchar(45) NULL COMMENT '座机号' AFTER `phone`")
    await queryRunner.query("ALTER TABLE `user` ADD COLUMN `birthday` date NULL COMMENT '生日' AFTER `email`")
    await queryRunner.query("ALTER TABLE `user` ADD COLUMN `work_no` varchar(100) NULL COMMENT '工号，唯一' AFTER `birthday`")
    await queryRunner.query("ALTER TABLE `user` ADD COLUMN `create_by` varchar(32) NULL COMMENT '创建人'")
    await queryRunner.query("ALTER TABLE `user` ADD COLUMN `update_by` varchar(32) NULL COMMENT '更新人'")
    await queryRunner.query("ALTER TABLE `user` ADD COLUMN `del_flag` tinyint NOT NULL DEFAULT 0 COMMENT '删除状态(0-正常,1-已删除)'")
    await queryRunner.query('ALTER TABLE `user` ADD UNIQUE INDEX `uniq_user_work_no` (`work_no`)')

    // 种子数据按 sys_user 风格更新：admin → 管理员/男/工号00001
    await queryRunner.query("UPDATE `user` SET `realname`='管理员', `sex`=1, `work_no`='00001' WHERE `username`='admin'")
    // 其余用户按现有 realname（原昵称）保留，工号顺延
    await queryRunner.query("UPDATE `user` SET `work_no`=LPAD(CAST(`id` + 1 AS CHAR), 5, '0') WHERE `work_no` IS NULL")
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `user` DROP INDEX `uniq_user_work_no`')
    await queryRunner.query('ALTER TABLE `user` DROP COLUMN `del_flag`')
    await queryRunner.query('ALTER TABLE `user` DROP COLUMN `update_by`')
    await queryRunner.query('ALTER TABLE `user` DROP COLUMN `create_by`')
    await queryRunner.query('ALTER TABLE `user` DROP COLUMN `work_no`')
    await queryRunner.query('ALTER TABLE `user` DROP COLUMN `birthday`')
    await queryRunner.query('ALTER TABLE `user` DROP COLUMN `telephone`')
    await queryRunner.query('ALTER TABLE `user` DROP COLUMN `phone`')
    await queryRunner.query('ALTER TABLE `user` DROP COLUMN `sex`')
    await queryRunner.query('ALTER TABLE `user` DROP COLUMN `avatar`')
    await queryRunner.query("ALTER TABLE `user` CHANGE COLUMN `realname` `nickname` varchar(32) NOT NULL COMMENT '昵称'")
    await queryRunner.query("ALTER TABLE `user` COMMENT=''")
  }
}
