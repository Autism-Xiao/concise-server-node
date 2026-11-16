import { type MigrationInterface, type QueryRunner } from 'typeorm'

/**
 * 系统参数配置表 + 首批内置参数 + 菜单权限
 *
 * 为什么要有这张表：字典管枚举值，个人设置管界面偏好，缺「运行时可调的标量」。
 * 密码策略、上传上限这类参数以前只能写死代码或改 env 重启，现在改完即时生效。
 *
 * 值一律存字符串，用 value_type 声明如何解析（string/number/boolean/json）。
 * 代码侧 DEFAULTS 兜底，所以这张表为空系统也能跑。
 */
export class CreateSysConfig1794400000000 implements MigrationInterface {
  name = 'CreateSysConfig1794400000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`sys_config\` (
        \`id\` int NOT NULL AUTO_INCREMENT COMMENT '主键',
        \`config_key\` varchar(128) NOT NULL COMMENT '参数键',
        \`config_value\` text NULL COMMENT '参数值',
        \`value_type\` varchar(16) NOT NULL DEFAULT 'string' COMMENT '值类型：string/number/boolean/json',
        \`config_group\` varchar(64) NOT NULL DEFAULT 'general' COMMENT '分组',
        \`name\` varchar(128) NOT NULL COMMENT '中文名',
        \`remark\` varchar(255) NULL COMMENT '说明',
        \`is_builtin\` tinyint NOT NULL DEFAULT 0 COMMENT '1内置',
        \`del_flag\` tinyint NOT NULL DEFAULT 0 COMMENT '0正常 1已删除',
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_config_key\` (\`config_key\`),
        KEY \`idx_config_group\` (\`config_group\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统参数配置'
    `)

    // 首批内置参数：密码策略 + 登录锁定阈值。INSERT IGNORE 保证重复执行安全
    await queryRunner.query(`
      INSERT IGNORE INTO \`sys_config\` (\`config_key\`, \`config_value\`, \`value_type\`, \`config_group\`, \`name\`, \`remark\`, \`is_builtin\`)
      VALUES
        ('security.password.minLength', '8', 'number', 'security', '密码最小长度', '新建/修改密码时的最少字符数，建议 8~20', 1),
        ('security.password.requireComplexity', 'true', 'boolean', 'security', '密码复杂度', 'true 时要求大写/小写/数字/符号至少三类', 1),
        ('security.password.expireDays', '90', 'number', 'security', '密码有效期（天）', '0 表示永不过期；到期后登录强制改密', 1),
        ('security.password.forceChangeOnFirstLogin', 'false', 'boolean', 'security', '首次登录强制改密', '管理员重置密码后，用户下次登录必须改密', 1),
        ('security.login.maxFailCount', '5', 'number', 'security', '登录失败锁定阈值', '连续失败达到该次数后锁定账号', 1)
    `)

    // 菜单挂「系统管理」下，排在租户管理之后（sort 9）
    await queryRunner.query(`
      INSERT IGNORE INTO \`sys_permission\` (\`id\`, \`parent_id\`, \`name\`, \`url\`, \`icon\`, \`menu_type\`, \`sort_no\`, \`status\`, \`del_flag\`, \`is_leaf\`, \`perms\`)
      VALUES
        ('menu_config', 'menu_1', '参数配置', '/system/config', 'Settings', 1, 9, '1', 0, 0, 'system:config:list'),
        ('menu_config_update', 'menu_config', '修改参数', NULL, NULL, 2, 1, '1', 0, 1, 'system:config:update')
    `)

    // 给每个租户的 admin 角色补授权（admin 本身有 bypass，这里保证权限树完整、按钮能显示）
    // 注意 sys_role 没有 del_flag 列，别照抄其他表的写法
    await queryRunner.query(`
      INSERT INTO \`sys_role_permission\` (\`role_id\`, \`permission_id\`)
      SELECT r.\`id\`, p.\`id\` FROM \`sys_role\` r CROSS JOIN \`sys_permission\` p
      WHERE r.\`role_code\` = 'admin' AND p.\`id\` IN ('menu_config', 'menu_config_update')
        AND NOT EXISTS (
          SELECT 1 FROM \`sys_role_permission\` rp WHERE rp.\`role_id\` = r.\`id\` AND rp.\`permission_id\` = p.\`id\`
        )
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DELETE FROM `sys_role_permission` WHERE `permission_id` IN (SELECT `id` FROM (SELECT `id` FROM `sys_permission` WHERE `id` IN ('menu_config','menu_config_update')) t)"
    )
    await queryRunner.query("DELETE FROM `sys_permission` WHERE `id` IN ('menu_config','menu_config_update')")
    await queryRunner.query('DROP TABLE IF EXISTS `sys_config`')
  }
}
