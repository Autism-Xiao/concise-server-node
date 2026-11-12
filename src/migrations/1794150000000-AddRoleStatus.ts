import { MigrationInterface, QueryRunner } from 'typeorm'

/** sys_role 加状态列：1 正常 / 0 停用 */
export class AddRoleStatus1794150000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasColumn = await queryRunner.hasColumn('sys_role', 'status')
    if (!hasColumn) {
      await queryRunner.query("ALTER TABLE `sys_role` ADD COLUMN `status` TINYINT NOT NULL DEFAULT 1 COMMENT '状态(1正常 0停用)'")
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasColumn = await queryRunner.hasColumn('sys_role', 'status')
    if (hasColumn) {
      await queryRunner.query('ALTER TABLE `sys_role` DROP COLUMN `status`')
    }
  }
}
