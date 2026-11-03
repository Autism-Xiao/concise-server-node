import { MigrationInterface, QueryRunner } from 'typeorm'

export class Migration1793735965438 implements MigrationInterface {
  name = 'Migration1793735965438'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`dict_type\` (\`id\` int NOT NULL AUTO_INCREMENT, \`name\` varchar(32) NOT NULL COMMENT '字典类型名称', \`code\` varchar(64) NOT NULL COMMENT '字典编码', \`status\` tinyint NOT NULL COMMENT '状态：0禁用 1启用' DEFAULT '1', \`remark\` varchar(255) NULL COMMENT '备注', \`created_at\` datetime(6) NOT NULL COMMENT '创建时间' DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL COMMENT '更新时间' DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), UNIQUE INDEX \`IDX_f6be8ac6002aa6726440ace44c\` (\`code\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`
    )
    await queryRunner.query(
      `CREATE TABLE \`dict_item\` (\`id\` int NOT NULL AUTO_INCREMENT, \`label\` varchar(32) NOT NULL COMMENT '字典标签', \`value\` varchar(64) NOT NULL COMMENT '字典值', \`dictTypeId\` int NOT NULL COMMENT '所属字典类型ID', \`sort\` int NOT NULL COMMENT '排序号' DEFAULT '0', \`status\` tinyint NOT NULL COMMENT '状态：0禁用 1启用' DEFAULT '1', \`remark\` varchar(255) NULL COMMENT '备注', \`created_at\` datetime(6) NOT NULL COMMENT '创建时间' DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL COMMENT '更新时间' DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`
    )
    await queryRunner.query(
      `ALTER TABLE \`dict_item\` ADD CONSTRAINT \`FK_458bccd9a996c3209daa4c3d206\` FOREIGN KEY (\`dictTypeId\`) REFERENCES \`dict_type\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`dict_item\` DROP FOREIGN KEY \`FK_458bccd9a996c3209daa4c3d206\``)
    await queryRunner.query(`DROP TABLE \`dict_item\``)
    await queryRunner.query(`DROP INDEX \`IDX_f6be8ac6002aa6726440ace44c\` ON \`dict_type\``)
    await queryRunner.query(`DROP TABLE \`dict_type\``)
  }
}
