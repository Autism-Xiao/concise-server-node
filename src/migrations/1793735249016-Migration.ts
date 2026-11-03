import { MigrationInterface, QueryRunner } from 'typeorm'

export class Migration1793735249016 implements MigrationInterface {
  name = 'Migration1793735249016'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`dept\` (\`id\` int NOT NULL AUTO_INCREMENT, \`name\` varchar(32) NOT NULL COMMENT '部门名称', \`parentId\` int NOT NULL COMMENT '父级ID，0为顶级' DEFAULT '0', \`sort\` int NOT NULL COMMENT '排序号' DEFAULT '0', \`leader\` varchar(32) NULL COMMENT '负责人', \`phone\` varchar(20) NULL COMMENT '联系电话', \`status\` tinyint NOT NULL COMMENT '状态：0禁用 1启用' DEFAULT '1', \`created_at\` datetime(6) NOT NULL COMMENT '创建时间' DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL COMMENT '更新时间' DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`
    )
    await queryRunner.query(
      `CREATE TABLE \`login_log\` (\`id\` int NOT NULL AUTO_INCREMENT, \`username\` varchar(32) NOT NULL COMMENT '登录用户名', \`status\` tinyint NOT NULL COMMENT '结果：0失败 1成功', \`message\` varchar(128) NOT NULL COMMENT '结果说明', \`ip\` varchar(64) NOT NULL COMMENT '登录IP', \`userAgent\` varchar(255) NULL COMMENT 'User-Agent', \`created_at\` datetime(6) NOT NULL COMMENT '登录时间' DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`
    )
    await queryRunner.query(
      `CREATE TABLE \`oper_log\` (\`id\` int NOT NULL AUTO_INCREMENT, \`userId\` int NULL COMMENT '操作人用户ID', \`username\` varchar(32) NULL COMMENT '操作人用户名', \`module\` varchar(64) NOT NULL COMMENT '操作模块', \`action\` varchar(128) NOT NULL COMMENT '操作动作（方法+路径）', \`ip\` varchar(64) NOT NULL COMMENT '请求IP', \`params\` text NULL COMMENT '请求参数（body+query JSON）', \`status\` tinyint NOT NULL COMMENT '结果：0失败 1成功', \`errorMsg\` varchar(255) NULL COMMENT '错误信息', \`elapsed\` int NOT NULL COMMENT '耗时（毫秒）', \`created_at\` datetime(6) NOT NULL COMMENT '操作时间' DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`
    )
    await queryRunner.query(`ALTER TABLE \`user\` ADD \`deptId\` int NOT NULL COMMENT '所属部门ID，0为未分配' DEFAULT '0'`)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`user\` DROP COLUMN \`deptId\``)
    await queryRunner.query(`DROP TABLE \`oper_log\``)
    await queryRunner.query(`DROP TABLE \`login_log\``)
    await queryRunner.query(`DROP TABLE \`dept\``)
  }
}
