import { type MigrationInterface, type QueryRunner } from 'typeorm'

/**
 * sys_user 增加个人简介（bio）
 *
 * 背景：个人资料页一直有个「个人简介」输入框，但此前是纯前端假数据 —— 库里根本没有落点，
 * 填了也存不下来。这里补一列：255 字符，跟 jeecg 的 remark 口径一致，够写一两句自我介绍；
 * 不参与唯一索引、不参与检索，纯展示字段。
 */
export class AddUserBio1794160000000 implements MigrationInterface {
  name = 'AddUserBio1794160000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasColumn = await queryRunner.hasColumn('sys_user', 'bio')
    if (!hasColumn) {
      await queryRunner.query("ALTER TABLE `sys_user` ADD COLUMN `bio` VARCHAR(255) NULL COMMENT '个人简介'")
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasColumn = await queryRunner.hasColumn('sys_user', 'bio')
    if (hasColumn) {
      await queryRunner.query('ALTER TABLE `sys_user` DROP COLUMN `bio`')
    }
  }
}
