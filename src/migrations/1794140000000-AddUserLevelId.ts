import { type MigrationInterface, type QueryRunner } from 'typeorm'

/**
 * sys_user 关联职级（sys_level）
 *
 * 背景：用户管理列表要对齐 jeecg 演示的「角色/职级/岗位/部门」列。
 * 角色、岗位、部门都已有关联，唯独职级此前只是独立字典表（sys_level），
 * 用户身上没有落点 —— 这里补 level_id 单选字段（一人一个职级）。
 */
export class AddUserLevelId1794140000000 implements MigrationInterface {
  name = 'AddUserLevelId1794140000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasColumn = await queryRunner.hasColumn('sys_user', 'level_id')
    if (!hasColumn) {
      await queryRunner.query("ALTER TABLE `sys_user` ADD COLUMN `level_id` VARCHAR(32) NULL COMMENT '职级ID(sys_level)'")
    }
    if (!(await this.hasIndex(queryRunner))) {
      await queryRunner.query('CREATE INDEX `idx_sys_user_level_id` ON `sys_user` (`level_id`)')
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await this.hasIndex(queryRunner)) {
      await queryRunner.query('DROP INDEX `idx_sys_user_level_id` ON `sys_user`')
    }
    const hasColumn = await queryRunner.hasColumn('sys_user', 'level_id')
    if (hasColumn) {
      await queryRunner.query('ALTER TABLE `sys_user` DROP COLUMN `level_id`')
    }
  }

  /** QueryRunner 没有 hasIndex（本版 TypeORM），走 information_schema 判重防迁移重跑报错 */
  private async hasIndex(queryRunner: QueryRunner): Promise<boolean> {
    const rows = await queryRunner.query(
      "SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_user' AND INDEX_NAME = 'idx_sys_user_level_id'"
    )
    return Number((rows as Array<{ n: number | string }>)[0]?.n ?? 0) > 0
  }
}
