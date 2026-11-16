import { type MigrationInterface, type QueryRunner } from 'typeorm'

/**
 * 备份自动化：参数 + 定时任务
 *
 * 以前备份靠人手敲 mysqldump（2026-11-16 那次整库覆盖就是手工做的），
 * 这里把「导出 + 导入校验 + 保留清理」固化成 backupDbJob，每天 02:00 自动跑。
 *
 * status=0 表示启用（调度器只挂 status=0 的任务）。若环境里没有 mysqldump，
 * 任务会在执行时失败并把原因写进「上次结果」，不会影响服务本身。
 */
export class AddBackupJob1794420000000 implements MigrationInterface {
  name = 'AddBackupJob1794420000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT IGNORE INTO \`sys_config\` (\`config_key\`, \`config_value\`, \`value_type\`, \`config_group\`, \`name\`, \`remark\`, \`is_builtin\`)
      VALUES
        ('ops.backup.keepCount', '7', 'number', 'ops', '备份保留份数', '只保留最近 N 份，超出的自动删除；本地磁盘紧张时调小', 1),
        ('ops.backup.verify', 'true', 'boolean', 'ops', '备份后导入校验', 'true 时每次备份都会在临时库真导入一遍并比对表数（慢 2~3 秒，但能确认备份真能用）', 1)
    `)

    await queryRunner.query(`
      INSERT IGNORE INTO \`sys_quartz_job\`
        (\`id\`, \`job_class_name\`, \`cron_expression\`, \`parameter\`, \`description\`, \`status\`, \`del_flag\`, \`create_time\`, \`update_time\`)
      VALUES
        ('job0000000000000000000000000003', 'backupDbJob', '0 0 2 * * *', NULL, '每天 02:00 全库备份（导出 → 导入校验 → 保留 7 份）', 0, 0, NOW(), NOW())
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DELETE FROM `sys_quartz_job` WHERE `id` = 'job0000000000000000000000000003'")
    await queryRunner.query("DELETE FROM `sys_config` WHERE `config_key` IN ('ops.backup.keepCount', 'ops.backup.verify')")
  }
}
