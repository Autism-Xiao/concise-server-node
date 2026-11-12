import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 日志表：login_log + oper_log 两张自增表合并为单表 sys_log
 * - id 为 32 位字符串
 * - log_type：0 登录日志 / 1 操作日志
 * - status：0 正常（成功）/ 1 异常（失败）——存量数据需取反映射
 * - 保留项目扩展列：browser/os/location（登录）、params/error_msg（操作）
 * - 存量数据迁移完成后 drop 旧表
 */
export class Migration1793786906437 implements MigrationInterface {
  name = 'Migration1793786906437'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`sys_log\` (
        \`id\` varchar(32) NOT NULL COMMENT '主键id',
        \`job_id\` varchar(32) NULL COMMENT '定时任务id',
        \`log_content\` varchar(1000) NOT NULL COMMENT '日志内容',
        \`log_type\` int NOT NULL COMMENT '日志类型（0登录日志，1操作日志）',
        \`operate_type\` int NULL COMMENT '操作类型（1查询 2添加 3更新 4删除 5导入 6导出）',
        \`operate_user_id\` varchar(32) NULL COMMENT '操作人员id',
        \`operate_user_name\` varchar(100) NOT NULL COMMENT '操作人员名称',
        \`ip\` varchar(100) NOT NULL COMMENT 'IP',
        \`status\` int NOT NULL COMMENT '操作状态（0正常，1异常）',
        \`cost_time\` bigint NULL COMMENT '耗时（毫秒）',
        \`browser\` varchar(64) NULL COMMENT '浏览器（UA解析，扩展列）',
        \`os\` varchar(64) NULL COMMENT '操作系统（UA解析，扩展列）',
        \`location\` varchar(128) NULL COMMENT 'IP归属地（ip2region，扩展列）',
        \`params\` text NULL COMMENT '请求参数（body+query JSON，扩展列）',
        \`error_msg\` varchar(500) NULL COMMENT '错误信息（扩展列）',
        \`create_by\` varchar(32) NULL COMMENT '创建人',
        \`create_time\` datetime NOT NULL COMMENT '创建时间',
        PRIMARY KEY (\`id\`),
        KEY \`idx_sys_log_type_time\` (\`log_type\`, \`create_time\`),
        KEY \`idx_sys_log_user\` (\`operate_user_name\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统日志表'
    `)

    // 迁移登录日志存量：status 1成功/0失败 → 新表 0成功/1失败；message+username 拼进 log_content
    await queryRunner.query(`
      INSERT INTO \`sys_log\` (\`id\`, \`log_content\`, \`log_type\`, \`operate_user_name\`, \`ip\`, \`status\`, \`browser\`, \`os\`, \`location\`, \`create_by\`, \`create_time\`)
      SELECT
        LPAD(HEX(1000000 + \`id\`), 32, '0'),
        CONCAT(\`message\`),
        0,
        \`username\`,
        \`ip\`,
        1 - \`status\`,
        \`browser\`,
        \`os\`,
        \`location\`,
        \`username\`,
        \`created_at\`
      FROM \`login_log\`
    `)

    // 迁移操作日志存量：module+action 拼进 log_content；status 取反；elapsed → cost_time
    await queryRunner.query(`
      INSERT INTO \`sys_log\` (\`id\`, \`log_content\`, \`log_type\`, \`operate_type\`, \`operate_user_id\`, \`operate_user_name\`, \`ip\`, \`status\`, \`cost_time\`, \`params\`, \`error_msg\`, \`create_by\`, \`create_time\`)
      SELECT
        LPAD(HEX(2000000 + \`id\`), 32, '0'),
        CONCAT(\`module\`, ' - ', \`action\`),
        1,
        NULL,
        \`user_id\`,
        \`username\`,
        \`ip\`,
        1 - \`status\`,
        \`elapsed\`,
        \`params\`,
        \`error_msg\`,
        \`username\`,
        \`created_at\`
      FROM \`oper_log\`
    `)

    await queryRunner.query('DROP TABLE IF EXISTS `login_log`')
    await queryRunner.query('DROP TABLE IF EXISTS `oper_log`')
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DELETE FROM `sys_log` WHERE `log_type` IN (0, 1)')
    await queryRunner.query('DROP TABLE IF EXISTS `sys_log`')
  }
}
