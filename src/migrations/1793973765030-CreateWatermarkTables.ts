import { type MigrationInterface, type QueryRunner } from 'typeorm'

/**
 * 页面安全水印：全局策略 + 用户级覆盖
 *
 * 背景：改造前水印开关存在前端 settings（全站共用一份、与登录用户无关），
 * 用户清掉本地存储就能关掉，管理员无法按人管控。这里把配置搬到服务端：
 *  - sys_watermark_setting：单行，admin 维护默认开关/文案/样式
 *  - sys_user_watermark：按用户覆盖，NULL 表示继承全局
 *
 * 初始值选择「默认开启 + 用户可自选关闭」：这是安全功能，默认关等于没做；
 * 若上线后不想惊扰用户，管理员在系统设置里把 enabled 置 0 或 mode 置 off 即可立即全站生效。
 */
export class CreateWatermarkTables1793973765030 implements MigrationInterface {
  name = 'CreateWatermarkTables1793973765030'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`sys_watermark_setting\` (
        \`id\`         TINYINT      NOT NULL DEFAULT 1 COMMENT '固定为1',
        \`enabled\`    TINYINT      NOT NULL DEFAULT 1 COMMENT '全局默认开关(1开 0关)',
        \`mode\`       VARCHAR(16)  NOT NULL DEFAULT 'optional' COMMENT '策略(optional/forced/off)',
        \`content\`    VARCHAR(200) NOT NULL DEFAULT '{username}' COMMENT '默认内容模板',
        \`density\`    VARCHAR(16)  NOT NULL DEFAULT 'default' COMMENT '默认密度',
        \`opacity\`    TINYINT      NOT NULL DEFAULT 8 COMMENT '不透明度百分比',
        \`rotate\`     SMALLINT     NOT NULL DEFAULT -22 COMMENT '倾斜角度',
        \`font_size\`  TINYINT      NOT NULL DEFAULT 14 COMMENT '字号px',
        \`updated_by\` VARCHAR(32)  NULL COMMENT '最后修改人',
        \`updated_at\` DATETIME     NULL COMMENT '最后修改时间',
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='页面水印全局策略'
    `)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`sys_user_watermark\` (
        \`user_id\`    VARCHAR(32)  NOT NULL COMMENT '用户ID',
        \`enabled\`    TINYINT      NULL COMMENT '开关(1开 0关 null继承全局)',
        \`enforced\`   TINYINT      NOT NULL DEFAULT 0 COMMENT '强管控(0不强制 1强制开 2强制关)',
        \`content\`    VARCHAR(200) NULL COMMENT '自定义内容模板',
        \`density\`    VARCHAR(16)  NULL COMMENT '自定义密度',
        \`updated_by\` VARCHAR(32)  NULL COMMENT '最后修改人',
        \`updated_at\` DATETIME     NULL COMMENT '最后修改时间',
        PRIMARY KEY (\`user_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户级页面水印配置'
    `)

    // 初始化单行全局配置（幂等：重复执行不会覆盖管理员已改过的值）
    await queryRunner.query(
      `INSERT IGNORE INTO \`sys_watermark_setting\`
         (\`id\`, \`enabled\`, \`mode\`, \`content\`, \`density\`, \`opacity\`, \`rotate\`, \`font_size\`, \`updated_at\`)
       VALUES (1, 1, 'optional', ?, 'default', 8, -22, 14, NOW())`,
      ['{username}\n{date} {time}']
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `sys_user_watermark`')
    await queryRunner.query('DROP TABLE IF EXISTS `sys_watermark_setting`')
  }
}
