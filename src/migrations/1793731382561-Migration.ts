import { MigrationInterface, QueryRunner } from "typeorm";

export class Migration1793731382561 implements MigrationInterface {
    name = 'Migration1793731382561'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`user\` (\`id\` int NOT NULL AUTO_INCREMENT, \`username\` varchar(32) NOT NULL COMMENT '用户名', \`nickname\` varchar(32) NOT NULL COMMENT '昵称', \`password\` varchar(128) NOT NULL COMMENT '密码（加密后）', \`email\` varchar(64) NULL COMMENT '邮箱', \`status\` tinyint NOT NULL COMMENT '状态：0禁用 1启用' DEFAULT '1', \`created_at\` datetime(6) NOT NULL COMMENT '创建时间' DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL COMMENT '更新时间' DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), UNIQUE INDEX \`IDX_78a916df40e02a9deb1c4b75ed\` (\`username\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX \`IDX_78a916df40e02a9deb1c4b75ed\` ON \`user\``);
        await queryRunner.query(`DROP TABLE \`user\``);
    }

}
