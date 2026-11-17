import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * sys_log 增加 is_proxy 列：标记「平台管理员代维」产生的操作
 *
 * isSuper && 当前租户 > 0 的写操作由 OperLogInterceptor 自动打 1，
 * 平台视角（tenant_id = 0）查业务数据的审计也打 1（伴随 P2 的 GET 审计落库）。
 * 租户侧日志列表用它展示「代维」标记，回答"这条记录是租户自己干的还是平台代维干的"。
 */
export class Migration1794920000000 implements MigrationInterface {
  name = 'Migration1794920000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE `sys_log` ADD COLUMN `is_proxy` TINYINT NOT NULL DEFAULT 0 COMMENT '平台管理员代维标记(1=代维/平台视角操作)' AFTER `tenant_id`"
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `sys_log` DROP COLUMN `is_proxy`')
  }
}
