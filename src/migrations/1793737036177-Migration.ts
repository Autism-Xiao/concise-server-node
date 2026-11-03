import { MigrationInterface, QueryRunner } from 'typeorm'

export class Migration1793737036177 implements MigrationInterface {
  name = 'Migration1793737036177'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`notice\` (\`id\` int NOT NULL AUTO_INCREMENT, \`title\` varchar(64) NOT NULL COMMENT '公告标题', \`type\` tinyint NOT NULL COMMENT '类型：1通知 2公告' DEFAULT '1', \`content\` text NULL COMMENT '公告内容', \`status\` tinyint NOT NULL COMMENT '状态：0草稿 1已发布' DEFAULT '0', \`published_at\` datetime NULL COMMENT '发布时间', \`created_at\` datetime(6) NOT NULL COMMENT '创建时间' DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL COMMENT '更新时间' DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`
    )
    await queryRunner.query(
      `CREATE TABLE \`task\` (\`id\` int NOT NULL AUTO_INCREMENT, \`title\` varchar(64) NOT NULL COMMENT '任务标题', \`description\` text NULL COMMENT '任务描述', \`priority\` tinyint NOT NULL COMMENT '优先级：0低 1中 2高' DEFAULT '1', \`status\` tinyint NOT NULL COMMENT '状态：0待处理 1进行中 2已完成 3已取消' DEFAULT '0', \`assigneeId\` int NOT NULL COMMENT '负责人用户ID，0为未指派' DEFAULT '0', \`due_date\` datetime NULL COMMENT '截止时间', \`created_at\` datetime(6) NOT NULL COMMENT '创建时间' DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL COMMENT '更新时间' DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`task\``)
    await queryRunner.query(`DROP TABLE \`notice\``)
  }
}
