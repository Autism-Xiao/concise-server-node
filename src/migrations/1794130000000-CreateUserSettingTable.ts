import { type MigrationInterface, type QueryRunner } from 'typeorm'

/**
 * 用户界面设置表（字号 / 主题色 / 布局 / 方向 …）
 *
 * 背景：这些偏好原来只有开发环境能持久化（vite dev server 读写项目根 settings.json），
 * 生产部署后一刷新就回到默认值。现在改为按用户存服务端，前端保留 localStorage 兜底。
 *
 * 不建 tenant_id：设置是账号级数据，切换租户时不该跟着变。
 */
export class CreateUserSettingTable1794130000000 implements MigrationInterface {
  name = 'CreateUserSettingTable1794130000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`sys_user_setting\` (
        \`user_id\` VARCHAR(32) NOT NULL COMMENT '用户ID',
        \`settings\` TEXT NOT NULL COMMENT '设置JSON(服务端按白名单裁剪)',
        \`update_time\` DATETIME NULL COMMENT '最后修改时间',
        PRIMARY KEY (\`user_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户界面设置'
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `sys_user_setting`')
  }
}
