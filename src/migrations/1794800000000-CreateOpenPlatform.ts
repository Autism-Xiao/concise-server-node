import { type MigrationInterface, type QueryRunner } from 'typeorm'

/**
 * 开放平台：应用（client_credentials）+ Webhook 订阅 + 投递日志
 *
 * 四张表：
 * - sys_app            应用档案：client_id / scopes / 状态。**没有 secret 列**——密钥只在
 *   sys_app_secret 里存 sha256 哈希，明文在「创建/重置」那一刻返回一次，之后永远不可见。
 * - sys_app_secret     密钥版本表：支持轮换（重置生成新版本、旧版本可撤销），prefix 存前 8 位
 *   明文用于列表展示识别（形如 ck_3f9a2b1c…）。
 * - sys_webhook        事件订阅：一个 URL 订一个事件，secret 是 HMAC 签名密钥（服务端要拿它
 *   算签名，与客户端共享，所以必须能取回，存明文但只对管理端可见）。
 * - sys_webhook_delivery  投递流水：每次派发一行，记最终成败与尝试次数，排查「对方说没收到」用。
 *
 * 菜单挂在「系统管理」（menu_1）下：/system/app，权限码 system:app:*（应用）与
 * system:webhook:*（订阅）。开放接口走独立前缀 /v1/open/**，不与用户侧接口混用。
 */
export class CreateOpenPlatform1794800000000 implements MigrationInterface {
  name = 'CreateOpenPlatform1794800000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`sys_app\` (
        \`id\` varchar(32) NOT NULL COMMENT '主键id',
        \`tenant_id\` int NOT NULL DEFAULT 0 COMMENT '租户ID(0=平台级)',
        \`app_name\` varchar(64) NOT NULL COMMENT '应用名称',
        \`client_id\` varchar(64) NOT NULL COMMENT '客户端ID(对第三方公开)',
        \`status\` char(1) NOT NULL DEFAULT '0' COMMENT '状态(0启用 1停用)',
        \`scopes\` text NULL COMMENT '授权范围(JSON数组，如 ["user:read","file:read"])',
        \`remark\` varchar(255) NULL COMMENT '备注',
        \`del_flag\` char(1) NOT NULL DEFAULT '0' COMMENT '删除标志(0存在 1删除)',
        \`create_by\` varchar(32) NULL COMMENT '创建人',
        \`create_time\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
        \`update_time\` datetime(3) NULL COMMENT '更新时间',
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_app_client\` (\`client_id\`),
        KEY \`idx_app_tenant\` (\`tenant_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='开放平台应用'
    `)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`sys_app_secret\` (
        \`id\` varchar(32) NOT NULL COMMENT '主键id',
        \`app_id\` varchar(32) NOT NULL COMMENT '应用id',
        \`secret_hash\` char(64) NOT NULL COMMENT 'client_secret的sha256哈希(明文永不落库)',
        \`secret_prefix\` varchar(12) NOT NULL COMMENT '密钥前8位明文(列表展示识别用)',
        \`status\` char(1) NOT NULL DEFAULT '0' COMMENT '状态(0有效 1撤销)',
        \`last_used_at\` datetime(3) NULL COMMENT '最近一次换取token时间',
        \`create_time\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
        PRIMARY KEY (\`id\`),
        KEY \`idx_appsecret_app\` (\`app_id\`, \`status\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='应用密钥版本'
    `)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`sys_webhook\` (
        \`id\` varchar(32) NOT NULL COMMENT '主键id',
        \`tenant_id\` int NOT NULL DEFAULT 0 COMMENT '租户ID(0=平台级)',
        \`app_id\` varchar(32) NULL COMMENT '所属应用(空=平台级订阅)',
        \`event\` varchar(64) NOT NULL COMMENT '订阅事件(如 user.created)',
        \`url\` varchar(500) NOT NULL COMMENT '回调地址(仅https)',
        \`secret\` varchar(64) NOT NULL COMMENT 'HMAC-SHA256签名密钥',
        \`status\` char(1) NOT NULL DEFAULT '0' COMMENT '状态(0启用 1停用)',
        \`del_flag\` char(1) NOT NULL DEFAULT '0' COMMENT '删除标志(0存在 1删除)',
        \`create_time\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
        \`update_time\` datetime(3) NULL COMMENT '更新时间',
        PRIMARY KEY (\`id\`),
        KEY \`idx_webhook_event\` (\`event\`, \`status\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Webhook订阅'
    `)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`sys_webhook_delivery\` (
        \`id\` varchar(32) NOT NULL COMMENT '主键id',
        \`webhook_id\` varchar(32) NOT NULL COMMENT '订阅id',
        \`event\` varchar(64) NOT NULL COMMENT '事件名',
        \`status\` char(1) NOT NULL COMMENT '投递结果(0成功 1失败)',
        \`attempts\` int NOT NULL DEFAULT 1 COMMENT '尝试次数(含重试)',
        \`response_code\` int NULL COMMENT '最后一次HTTP状态码',
        \`error\` varchar(500) NULL COMMENT '失败原因',
        \`payload\` text NULL COMMENT '请求体快照',
        \`create_time\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '投递时间',
        PRIMARY KEY (\`id\`),
        KEY \`idx_delivery_hook\` (\`webhook_id\`, \`create_time\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Webhook投递日志'
    `)

    // 菜单 + 按钮权限。is_leaf：目录 0、叶子 1（与 menu_config 的写法一致）
    await queryRunner.query(`
      INSERT IGNORE INTO \`sys_permission\` (\`id\`, \`parent_id\`, \`name\`, \`url\`, \`icon\`, \`menu_type\`, \`sort_no\`, \`status\`, \`del_flag\`, \`is_leaf\`, \`perms\`)
      VALUES
        ('menu_openapp', 'menu_1', '开放平台', '/system/app', 'Network', 1, 10, '1', 0, 0, 'system:app:list'),
        ('menu_openapp_create', 'menu_openapp', '创建应用', NULL, NULL, 2, 1, '1', 0, 1, 'system:app:create'),
        ('menu_openapp_update', 'menu_openapp', '编辑应用', NULL, NULL, 2, 2, '1', 0, 1, 'system:app:update'),
        ('menu_openapp_delete', 'menu_openapp', '删除应用', NULL, NULL, 2, 3, '1', 0, 1, 'system:app:delete'),
        ('menu_openapp_reset', 'menu_openapp', '重置密钥', NULL, NULL, 2, 4, '1', 0, 1, 'system:app:reset'),
        ('menu_webhook_create', 'menu_openapp', '创建订阅', NULL, NULL, 2, 5, '1', 0, 1, 'system:webhook:create'),
        ('menu_webhook_update', 'menu_openapp', '编辑订阅', NULL, NULL, 2, 6, '1', 0, 1, 'system:webhook:update'),
        ('menu_webhook_delete', 'menu_openapp', '删除订阅', NULL, NULL, 2, 7, '1', 0, 1, 'system:webhook:delete')
    `)

    await queryRunner.query(`
      INSERT INTO \`sys_role_permission\` (\`role_id\`, \`permission_id\`)
      SELECT r.\`id\`, p.\`id\` FROM \`sys_role\` r CROSS JOIN \`sys_permission\` p
      WHERE r.\`role_code\` = 'admin' AND p.\`id\` IN ('menu_openapp','menu_openapp_create','menu_openapp_update','menu_openapp_delete','menu_openapp_reset','menu_webhook_create','menu_webhook_update','menu_webhook_delete')
        AND NOT EXISTS (
          SELECT 1 FROM \`sys_role_permission\` rp WHERE rp.\`role_id\` = r.\`id\` AND rp.\`permission_id\` = p.\`id\`
        )
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DELETE FROM `sys_role_permission` WHERE `permission_id` IN ('menu_openapp','menu_openapp_create','menu_openapp_update','menu_openapp_delete','menu_openapp_reset','menu_webhook_create','menu_webhook_update','menu_webhook_delete')"
    )
    await queryRunner.query(
      "DELETE FROM `sys_permission` WHERE `id` IN ('menu_openapp','menu_openapp_create','menu_openapp_update','menu_openapp_delete','menu_openapp_reset','menu_webhook_create','menu_webhook_update','menu_webhook_delete')"
    )
    await queryRunner.query('DROP TABLE IF EXISTS `sys_webhook_delivery`')
    await queryRunner.query('DROP TABLE IF EXISTS `sys_webhook`')
    await queryRunner.query('DROP TABLE IF EXISTS `sys_app_secret`')
    await queryRunner.query('DROP TABLE IF EXISTS `sys_app`')
  }
}
