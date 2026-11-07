import { type MigrationInterface, type QueryRunner } from 'typeorm'

/**
 * 站内信两张表：sys_message（内容）+ sys_message_user（接收人 × 已读状态）
 *
 * 底座此前只有「公告」（广播）与「日历提醒」（单一业务消息），
 * 没有通用的点对点消息能力。这里补齐：模板暂不做（等渠道中心一起），
 * 已读状态挂关联表，UNIQUE(message_id, user_id) 保证重复投递幂等。
 */
export class CreateSysMessage1794210000000 implements MigrationInterface {
  name = 'CreateSysMessage1794210000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`sys_message\` (
        \`id\` char(36) NOT NULL COMMENT '消息ID',
        \`title\` varchar(128) NOT NULL COMMENT '标题',
        \`content\` text NOT NULL COMMENT '正文',
        \`msg_type\` varchar(16) NOT NULL DEFAULT 'send' COMMENT '消息类型：send/system',
        \`sender_id\` varchar(32) NULL COMMENT '发送人用户ID',
        \`tenant_id\` int NOT NULL DEFAULT 1 COMMENT '租户ID(0=平台共享)',
        \`receiver_count\` int NOT NULL DEFAULT 0 COMMENT '接收人数',
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
        PRIMARY KEY (\`id\`),
        KEY \`idx_message_tenant\` (\`tenant_id\`, \`created_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='站内信'
    `)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`sys_message_user\` (
        \`id\` char(36) NOT NULL COMMENT '主键',
        \`message_id\` char(36) NOT NULL COMMENT '消息ID',
        \`user_id\` varchar(32) NOT NULL COMMENT '接收人用户ID',
        \`is_read\` tinyint NOT NULL DEFAULT 0 COMMENT '0未读 1已读',
        \`read_at\` datetime(6) NULL COMMENT '阅读时间',
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_message_user\` (\`message_id\`, \`user_id\`),
        KEY \`idx_message_user_user\` (\`user_id\`, \`is_read\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='站内信接收人'
    `)
    // 菜单：消息中心挂「协同办公」下（第三个子项），按钮 3 个
    await queryRunner.query(`
      INSERT IGNORE INTO \`sys_permission\` (\`id\`, \`parent_id\`, \`name\`, \`url\`, \`icon\`, \`menu_type\`, \`sort_no\`, \`status\`, \`del_flag\`, \`is_leaf\`, \`perms\`)
      VALUES
        ('menu_msg', 'menu_collab', '消息中心', '/system/message', 'Mail', 1, 3, '1', 0, 0, 'system:message:list'),
        ('menu_msg_send', 'menu_msg', '发送消息', NULL, NULL, 2, 1, '1', 0, 1, 'system:message:send'),
        ('menu_msg_del', 'menu_msg', '删除消息', NULL, NULL, 2, 2, '1', 0, 1, 'system:message:delete')
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DELETE FROM `sys_role_permission` WHERE `permission_id` IN (SELECT `id` FROM (SELECT `id` FROM `sys_permission` WHERE `id` IN ('menu_msg','menu_msg_send','menu_msg_del')) t)"
    )
    await queryRunner.query("DELETE FROM `sys_permission` WHERE `id` IN ('menu_msg','menu_msg_send','menu_msg_del')")
    await queryRunner.query('DROP TABLE IF EXISTS `sys_message_user`')
    await queryRunner.query('DROP TABLE IF EXISTS `sys_message`')
  }
}
