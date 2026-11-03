import { MigrationInterface, QueryRunner } from 'typeorm'

export class Migration1793734321882 implements MigrationInterface {
  name = 'Migration1793734321882'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`role\` (\`id\` int NOT NULL AUTO_INCREMENT, \`name\` varchar(32) NOT NULL COMMENT '角色标识', \`label\` varchar(32) NOT NULL COMMENT '角色名称', \`status\` tinyint NOT NULL COMMENT '状态：0禁用 1启用' DEFAULT '1', \`remark\` varchar(255) NULL COMMENT '备注', UNIQUE INDEX \`IDX_ae4578dcaed5adff96595e6166\` (\`name\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`
    )
    await queryRunner.query(
      `CREATE TABLE \`menu\` (\`id\` int NOT NULL AUTO_INCREMENT, \`name\` varchar(32) NOT NULL COMMENT '菜单名称', \`type\` tinyint NOT NULL COMMENT '类型：0目录 1菜单 2按钮' DEFAULT '1', \`path\` varchar(128) NULL COMMENT '路由路径', \`component\` varchar(128) NULL COMMENT '前端组件路径', \`icon\` varchar(64) NULL COMMENT '图标', \`permission\` varchar(64) NULL COMMENT '权限标识', \`parentId\` int NOT NULL COMMENT '父级ID，0为顶级' DEFAULT '0', \`sort\` int NOT NULL COMMENT '排序号' DEFAULT '0', \`status\` tinyint NOT NULL COMMENT '状态：0禁用 1启用' DEFAULT '1', \`created_at\` datetime(6) NOT NULL COMMENT '创建时间' DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL COMMENT '更新时间' DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`
    )
    await queryRunner.query(
      `CREATE TABLE \`user_roles\` (\`userId\` int NOT NULL, \`roleId\` int NOT NULL, INDEX \`IDX_472b25323af01488f1f66a06b6\` (\`userId\`), INDEX \`IDX_86033897c009fcca8b6505d6be\` (\`roleId\`), PRIMARY KEY (\`userId\`, \`roleId\`)) ENGINE=InnoDB`
    )
    await queryRunner.query(
      `CREATE TABLE \`role_menus\` (\`menuId\` int NOT NULL, \`roleId\` int NOT NULL, INDEX \`IDX_b447ba2d495fdf8e4a489afa3f\` (\`menuId\`), INDEX \`IDX_1edf55a2d483f8aa59ea943a77\` (\`roleId\`), PRIMARY KEY (\`menuId\`, \`roleId\`)) ENGINE=InnoDB`
    )
    await queryRunner.query(
      `ALTER TABLE \`user_roles\` ADD CONSTRAINT \`FK_472b25323af01488f1f66a06b67\` FOREIGN KEY (\`userId\`) REFERENCES \`user\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`
    )
    await queryRunner.query(
      `ALTER TABLE \`user_roles\` ADD CONSTRAINT \`FK_86033897c009fcca8b6505d6be2\` FOREIGN KEY (\`roleId\`) REFERENCES \`role\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`
    )
    await queryRunner.query(
      `ALTER TABLE \`role_menus\` ADD CONSTRAINT \`FK_b447ba2d495fdf8e4a489afa3fc\` FOREIGN KEY (\`menuId\`) REFERENCES \`menu\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`
    )
    await queryRunner.query(
      `ALTER TABLE \`role_menus\` ADD CONSTRAINT \`FK_1edf55a2d483f8aa59ea943a771\` FOREIGN KEY (\`roleId\`) REFERENCES \`role\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`role_menus\` DROP FOREIGN KEY \`FK_1edf55a2d483f8aa59ea943a771\``)
    await queryRunner.query(`ALTER TABLE \`role_menus\` DROP FOREIGN KEY \`FK_b447ba2d495fdf8e4a489afa3fc\``)
    await queryRunner.query(`ALTER TABLE \`user_roles\` DROP FOREIGN KEY \`FK_86033897c009fcca8b6505d6be2\``)
    await queryRunner.query(`ALTER TABLE \`user_roles\` DROP FOREIGN KEY \`FK_472b25323af01488f1f66a06b67\``)
    await queryRunner.query(`DROP INDEX \`IDX_1edf55a2d483f8aa59ea943a77\` ON \`role_menus\``)
    await queryRunner.query(`DROP INDEX \`IDX_b447ba2d495fdf8e4a489afa3f\` ON \`role_menus\``)
    await queryRunner.query(`DROP TABLE \`role_menus\``)
    await queryRunner.query(`DROP INDEX \`IDX_86033897c009fcca8b6505d6be\` ON \`user_roles\``)
    await queryRunner.query(`DROP INDEX \`IDX_472b25323af01488f1f66a06b6\` ON \`user_roles\``)
    await queryRunner.query(`DROP TABLE \`user_roles\``)
    await queryRunner.query(`DROP TABLE \`menu\``)
    await queryRunner.query(`DROP INDEX \`IDX_ae4578dcaed5adff96595e6166\` ON \`role\``)
    await queryRunner.query(`DROP TABLE \`role\``)
  }
}
