import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 定时任务表：与 JeecgBoot 官方 DDL 完全一致（表名 sys_quartz_job，字段名/类型不改造）
 *
 * JeecgBoot 原表字段（MySQL 版）：
 * - id             varchar(32) 主键
 * - create_by/create_time/del_flag/update_by/update_time  审计四件套 + 删除标记
 * - job_class_name varchar(255) 任务类名（JeecgBoot 里是 Quartz Job 实现类全限定名；
 *                               Node 侧没有 Java 类，按「执行器标识」使用，见 JobHandlerRegistry）
 * - cron_expression varchar(255) cron 表达式
 * - parameter      varchar(255) 参数（原样传给执行器）
 * - description    varchar(255) 描述
 * - status         int(1) 状态：0 正常（运行中）/ -1 停止
 *
 * 注意 collation 必须跟库内既有表一致（utf8mb4_unicode_ci），否则与 sys_user 等表 JOIN 会报
 * ER_CANT_AGGREGATE_2COLLATIONS。
 */
export class Migration1793789243974 implements MigrationInterface {
  name = 'Migration1793789243974'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`sys_quartz_job\` (
        \`id\` varchar(32) NOT NULL COMMENT '主键id',
        \`create_by\` varchar(32) NULL COMMENT '创建人',
        \`create_time\` datetime NULL COMMENT '创建时间',
        \`del_flag\` int(1) NULL DEFAULT 0 COMMENT '删除状态（0正常 1已删除）',
        \`update_by\` varchar(32) NULL COMMENT '修改人',
        \`update_time\` datetime NULL COMMENT '修改时间',
        \`job_class_name\` varchar(255) NULL COMMENT '任务类名',
        \`cron_expression\` varchar(255) NULL COMMENT 'cron表达式',
        \`parameter\` varchar(255) NULL COMMENT '参数',
        \`description\` varchar(255) NULL COMMENT '描述',
        \`status\` int(1) NULL DEFAULT 0 COMMENT '状态（0正常 -1停止）',
        PRIMARY KEY (\`id\`),
        KEY \`idx_quartz_job_status\` (\`status\`)
      ) ENGINE = InnoDB CHARACTER SET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '定时任务'
    `)

    // 内置示例任务：默认「停止」状态，避免部署后自动跑起来改数据，需要时在页面上启用
    await queryRunner.query(`
      INSERT INTO \`sys_quartz_job\`
        (id, create_by, create_time, del_flag, job_class_name, cron_expression, parameter, description, status)
      VALUES
        ('job0000000000000000000000000001', 'system', NOW(), 0, 'cleanLogJob', '0 0 3 * * *', '30', '每天 03:00 清理 30 天前的登录/操作日志', -1),
        ('job0000000000000000000000000002', 'system', NOW(), 0, 'heartbeatJob', '0 */10 * * * *', NULL, '每 10 分钟输出一次心跳日志（用于验证调度是否正常）', -1)
      ON DUPLICATE KEY UPDATE update_time = NOW()
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `sys_quartz_job`')
  }
}
