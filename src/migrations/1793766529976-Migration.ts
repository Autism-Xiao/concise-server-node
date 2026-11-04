import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * role → sys_role、menu → sys_permission、dept → sys_depart（对齐 JeecgBoot）
 *
 * 要点：
 * 1. 三张表主键由 int 自增改为 varchar(32)，旧数据用确定性规则映射：
 *    role  → admin 固定 JeecgBoot id，其余 UUID
 *    menu  → 'menu_<旧id>'，parent_id 0 转 NULL
 *    dept  → 'dept_<旧id>'，parent_id 0 转 NULL
 * 2. 关联表重建：user_roles → sys_user_role、role_menus → sys_role_permission
 *    （JeecgBoot 结构带独立 id，用 DEFAULT (replace(uuid(),'-','')) 让 TypeORM 插入时无需提供）
 * 3. dept 的机构编码 org_code 唯一必填：按树层级自动生成 A01 / A01A01
 * 4. sys_user.dept_id 同步改为 varchar(32) 并按新 dept id 重写，org_code 回填
 */
export class Migration1793766529976 implements MigrationInterface {
  name = 'Migration1793766529976'

  public async up(queryRunner: QueryRunner): Promise<void> {
    /* ---------------- 1. sys_role ---------------- */
    await queryRunner.query('DROP TABLE IF EXISTS `sys_role`')
    await queryRunner.query(`CREATE TABLE \`sys_role\` (
      \`id\` varchar(32) NOT NULL COMMENT '主键id',
      \`role_name\` varchar(200) DEFAULT NULL COMMENT '角色名称',
      \`role_code\` varchar(100) NOT NULL COMMENT '角色编码',
      \`description\` varchar(255) DEFAULT NULL COMMENT '描述',
      \`create_by\` varchar(32) DEFAULT NULL COMMENT '创建人',
      \`create_time\` datetime DEFAULT NULL COMMENT '创建时间',
      \`update_by\` varchar(32) DEFAULT NULL COMMENT '更新人',
      \`update_time\` datetime DEFAULT NULL COMMENT '更新时间',
      \`tenant_id\` int DEFAULT '0' COMMENT '租户ID',
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`uniq_sys_role_role_code\` (\`role_code\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色表'`)

    // 旧 role.name → sys_role.role_code，label → role_name；admin 沿用 JeecgBoot 初始 id
    await queryRunner.query(`INSERT INTO \`sys_role\` (\`id\`, \`role_name\`, \`role_code\`, \`description\`, \`create_by\`, \`create_time\`, \`update_by\`, \`update_time\`, \`tenant_id\`)
      SELECT CASE WHEN \`name\` = 'admin' THEN 'f6817f48af4fb3af11b9e8bf182f618b' ELSE REPLACE(UUID(), '-', '') END,
             \`label\`, \`name\`, \`remark\`, 'admin', NOW(), 'admin', NOW(), 0
      FROM \`role\``)

    /* ---------------- 2. sys_user_role（替换 user_roles） ---------------- */
    await queryRunner.query('DROP TABLE IF EXISTS `sys_user_role`')
    await queryRunner.query(`CREATE TABLE \`sys_user_role\` (
      \`id\` varchar(32) NOT NULL DEFAULT (replace(uuid(),'-','')) COMMENT '主键id',
      \`user_id\` varchar(32) DEFAULT NULL COMMENT '用户id',
      \`role_id\` varchar(32) DEFAULT NULL COMMENT '角色id',
      \`tenant_id\` int DEFAULT '0' COMMENT '租户ID',
      PRIMARY KEY (\`id\`),
      KEY \`idx_sur_user_id\` (\`user_id\`),
      KEY \`idx_sur_role_id\` (\`role_id\`),
      UNIQUE KEY \`uniq_sur_user_role\` (\`user_id\`,\`role_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户角色表'`)

    await queryRunner.query(`INSERT INTO \`sys_user_role\` (\`user_id\`, \`role_id\`, \`tenant_id\`)
      SELECT ur.\`user_id\`, r.\`id\`, 0
      FROM \`user_roles\` ur
      JOIN \`role\` o ON o.\`id\` = ur.\`role_id\`
      JOIN \`sys_role\` r ON r.\`role_code\` = o.\`name\``)

    /* ---------------- 3. sys_permission（替换 menu） ---------------- */
    await queryRunner.query('DROP TABLE IF EXISTS `sys_permission`')
    await queryRunner.query(`CREATE TABLE \`sys_permission\` (
      \`id\` varchar(32) NOT NULL COMMENT '主键id',
      \`parent_id\` varchar(32) DEFAULT NULL COMMENT '父id',
      \`name\` varchar(255) DEFAULT NULL COMMENT '菜单标题',
      \`url\` varchar(255) DEFAULT NULL COMMENT '路径',
      \`component\` varchar(255) DEFAULT NULL COMMENT '组件',
      \`is_route\` tinyint DEFAULT '1' COMMENT '是否路由菜单: 0:不是  1:是（默认值1）',
      \`component_name\` varchar(255) DEFAULT NULL COMMENT '组件名字',
      \`redirect\` varchar(255) DEFAULT NULL COMMENT '一级菜单跳转地址',
      \`menu_type\` int DEFAULT NULL COMMENT '菜单类型(0:一级菜单; 1:子菜单:2:按钮权限)',
      \`perms\` varchar(255) DEFAULT NULL COMMENT '菜单权限编码',
      \`perms_type\` varchar(10) DEFAULT '0' COMMENT '权限策略1显示2禁用',
      \`sort_no\` double DEFAULT NULL COMMENT '菜单排序',
      \`always_show\` tinyint DEFAULT NULL COMMENT '聚合子路由: 1是0否',
      \`icon\` varchar(255) DEFAULT NULL COMMENT '菜单图标',
      \`is_leaf\` tinyint DEFAULT NULL COMMENT '是否叶子节点:    1是0否',
      \`keep_alive\` tinyint DEFAULT NULL COMMENT '是否缓存该页面:    1:是   0:不是',
      \`hidden\` tinyint DEFAULT '0' COMMENT '是否隐藏路由: 0否,1是',
      \`hide_tab\` tinyint DEFAULT NULL COMMENT '是否隐藏tab: 0否,1是',
      \`description\` varchar(255) DEFAULT NULL COMMENT '描述',
      \`create_by\` varchar(255) DEFAULT NULL COMMENT '创建人',
      \`create_time\` datetime DEFAULT NULL COMMENT '创建时间',
      \`update_by\` varchar(255) DEFAULT NULL COMMENT '更新人',
      \`update_time\` datetime DEFAULT NULL COMMENT '更新时间',
      \`del_flag\` int DEFAULT '0' COMMENT '删除状态 0正常 1已删除',
      \`rule_flag\` int DEFAULT '0' COMMENT '是否添加数据权限1是0否',
      \`status\` varchar(2) DEFAULT NULL COMMENT '按钮权限状态(0无效1有效)',
      \`internal_or_external\` tinyint DEFAULT NULL COMMENT '外链菜单打开方式 0/内部打开 1/外部打开',
      PRIMARY KEY (\`id\`),
      KEY \`index_menu_type\` (\`menu_type\`),
      KEY \`index_menu_hidden\` (\`hidden\`),
      KEY \`index_menu_status\` (\`status\`),
      KEY \`index_menu_del_flag\` (\`del_flag\`),
      KEY \`index_menu_url\` (\`url\`),
      KEY \`index_menu_sort_no\` (\`sort_no\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='菜单权限表'`)

    await queryRunner.query(`INSERT INTO \`sys_permission\`
      (\`id\`, \`parent_id\`, \`name\`, \`url\`, \`component\`, \`is_route\`, \`menu_type\`, \`perms\`, \`perms_type\`,
       \`sort_no\`, \`icon\`, \`is_leaf\`, \`keep_alive\`, \`hidden\`, \`del_flag\`, \`rule_flag\`, \`status\`,
       \`create_by\`, \`create_time\`, \`update_by\`, \`update_time\`)
      SELECT CONCAT('menu_', m.\`id\`),
             CASE WHEN m.\`parent_id\` > 0 THEN CONCAT('menu_', m.\`parent_id\`) ELSE NULL END,
             m.\`name\`, m.\`path\`, m.\`component\`, 1, m.\`type\`, m.\`permission\`, '1',
             m.\`sort\`, m.\`icon\`, IF(m.\`type\` = 2, 1, 0), 0, 0, 0, 0, IF(m.\`status\` = 1, '1', '0'),
             'admin', m.\`created_at\`, 'admin', m.\`updated_at\`
      FROM \`menu\` m`)

    /* ---------------- 4. sys_role_permission（替换 role_menus） ---------------- */
    await queryRunner.query('DROP TABLE IF EXISTS `sys_role_permission`')
    await queryRunner.query(`CREATE TABLE \`sys_role_permission\` (
      \`id\` varchar(32) NOT NULL DEFAULT (replace(uuid(),'-','')),
      \`role_id\` varchar(32) DEFAULT NULL COMMENT '角色id',
      \`permission_id\` varchar(32) DEFAULT NULL COMMENT '权限id',
      \`data_rule_ids\` varchar(1000) DEFAULT NULL COMMENT '数据权限ids',
      \`operate_date\` datetime DEFAULT NULL COMMENT '操作时间',
      \`operate_ip\` varchar(100) DEFAULT NULL COMMENT '操作ip',
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`uniq_srp_role_permission\` (\`role_id\`,\`permission_id\`),
      KEY \`idx_srp_role_id\` (\`role_id\`),
      KEY \`idx_srp_permission_id\` (\`permission_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色权限表'`)

    await queryRunner.query(`INSERT INTO \`sys_role_permission\` (\`role_id\`, \`permission_id\`, \`operate_date\`)
      SELECT r.\`id\`, CONCAT('menu_', rm.\`menu_id\`), NOW()
      FROM \`role_menus\` rm
      JOIN \`role\` o ON o.\`id\` = rm.\`role_id\`
      JOIN \`sys_role\` r ON r.\`role_code\` = o.\`name\``)

    /* ---------------- 5. 旧表退场 ---------------- */
    await queryRunner.query('DROP TABLE IF EXISTS `role_menus`')
    await queryRunner.query('DROP TABLE IF EXISTS `user_roles`')
    await queryRunner.query('DROP TABLE IF EXISTS `menu`')
    await queryRunner.query('DROP TABLE IF EXISTS `role`')

    /* ---------------- 6. sys_depart（替换 dept） ---------------- */
    await queryRunner.query('DROP TABLE IF EXISTS `sys_depart`')
    await queryRunner.query(`CREATE TABLE \`sys_depart\` (
      \`id\` varchar(32) NOT NULL COMMENT 'ID',
      \`parent_id\` varchar(32) DEFAULT NULL COMMENT '父机构ID',
      \`depart_name\` varchar(100) NOT NULL COMMENT '机构/部门名称',
      \`depart_name_en\` varchar(500) DEFAULT NULL COMMENT '英文名',
      \`depart_name_abbr\` varchar(500) DEFAULT NULL COMMENT '缩写',
      \`depart_order\` int DEFAULT '0' COMMENT '排序',
      \`description\` varchar(500) DEFAULT NULL COMMENT '描述',
      \`org_category\` varchar(10) NOT NULL DEFAULT '1' COMMENT '机构类别 1公司，2部门，3岗位，4子公司',
      \`org_type\` varchar(10) DEFAULT NULL COMMENT '树深度层级level',
      \`org_code\` varchar(64) NOT NULL COMMENT '机构编码',
      \`mobile\` varchar(32) DEFAULT NULL COMMENT '手机号',
      \`fax\` varchar(32) DEFAULT NULL COMMENT '传真',
      \`address\` varchar(100) DEFAULT NULL COMMENT '地址',
      \`memo\` varchar(500) DEFAULT NULL COMMENT '备注',
      \`status\` varchar(1) DEFAULT NULL COMMENT '状态（1启用，0不启用）',
      \`del_flag\` varchar(1) DEFAULT NULL COMMENT '删除状态（0，正常，1已删除）',
      \`qywx_identifier\` varchar(100) DEFAULT NULL COMMENT '对接企业微信的ID',
      \`ding_identifier\` varchar(100) DEFAULT NULL COMMENT '对接钉钉部门的ID',
      \`feishu_identifier\` varchar(100) DEFAULT NULL COMMENT '对接飞书的部门ID',
      \`create_by\` varchar(32) DEFAULT NULL COMMENT '创建人',
      \`create_time\` datetime DEFAULT NULL COMMENT '创建日期',
      \`update_by\` varchar(32) DEFAULT NULL COMMENT '更新人',
      \`update_time\` datetime DEFAULT NULL COMMENT '更新日期',
      \`tenant_id\` int DEFAULT '0' COMMENT '租户ID',
      \`iz_leaf\` tinyint DEFAULT '0' COMMENT '是否有叶子节点: 1是0否',
      \`position_id\` varchar(32) DEFAULT NULL COMMENT '职级id',
      \`dep_post_parent_id\` varchar(32) DEFAULT NULL COMMENT '上级岗位id',
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`uniq_depart_org_code\` (\`org_code\`),
      KEY \`idx_sd_parent_id\` (\`parent_id\`),
      KEY \`idx_sd_depart_order\` (\`depart_order\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='组织机构表'`)

    // 机构编码按树层级生成（A01 / A01A01），并保持父在前
    const oldDepts: Array<{
      id: number
      name: string
      parent_id: number
      sort: number
      leader: string | null
      phone: string | null
      status: number
      created_at: Date
      updated_at: Date
    }> = await queryRunner.query('SELECT `id`, `name`, `parent_id`, `sort`, `leader`, `phone`, `status`, `created_at`, `updated_at` FROM `dept` ORDER BY `id`')

    const childrenOf = (parentId: number) => oldDepts.filter(d => d.parent_id === parentId)
    const rows: Array<[string, string | null, string, number, number, string | null, string | null, string, Date, Date]> = []
    const walk = (parentId: number, parentCode: string | null) => {
      childrenOf(parentId).forEach((dept, index) => {
        const code = `${parentCode ?? ''}A${String(index + 1).padStart(2, '0')}`
        rows.push([
          `dept_${dept.id}`,
          parentId === 0 ? null : `dept_${parentId}`,
          dept.name,
          dept.sort ?? 0,
          dept.status === 1 ? 1 : 0,
          dept.leader,
          dept.phone,
          code,
          dept.created_at,
          dept.updated_at
        ])
        walk(dept.id, code)
      })
    }
    walk(0, null)

    for (const row of rows) {
      await queryRunner.query(
        `INSERT INTO \`sys_depart\` (\`id\`, \`parent_id\`, \`depart_name\`, \`depart_order\`, \`status\`, \`description\`, \`mobile\`, \`org_code\`, \`org_category\`, \`del_flag\`, \`create_by\`, \`create_time\`, \`update_by\`, \`update_time\`)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2', '0', 'admin', ?, 'admin', ?)`,
        [row[0], row[1], row[2], row[3], row[4] === 1 ? '1' : '0', row[5] ? `负责人：${row[5]}` : null, row[6], row[7], row[8], row[9]]
      )
    }

    // 用户归属部门：dept_id 改 varchar 并重写，org_code 从部门带出
    await queryRunner.query("ALTER TABLE `sys_user` MODIFY COLUMN `dept_id` varchar(32) DEFAULT NULL COMMENT '所属部门ID（sys_depart.id，本项目扩展）'")
    await queryRunner.query("UPDATE `sys_user` SET `dept_id` = CONCAT('dept_', `dept_id`) WHERE `dept_id` IS NOT NULL AND `dept_id` <> ''")
    await queryRunner.query('UPDATE `sys_user` u JOIN `sys_depart` d ON d.`id` = u.`dept_id` SET u.`org_code` = d.`org_code`')

    await queryRunner.query('DROP TABLE IF EXISTS `dept`')
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    /* 反向：新建旧表 → 从新表回灌 → 删除新表 */
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS \`role\` (
      \`id\` int NOT NULL AUTO_INCREMENT,
      \`name\` varchar(32) NOT NULL,
      \`label\` varchar(32) NOT NULL,
      \`status\` tinyint NOT NULL DEFAULT '1',
      \`remark\` varchar(255) DEFAULT NULL,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`IDX_role_name\` (\`name\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色'`)
    await queryRunner.query('INSERT INTO `role` (`name`, `label`, `status`, `remark`) SELECT `role_code`, `role_name`, 1, `description` FROM `sys_role`')

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS \`menu\` (
      \`id\` int NOT NULL AUTO_INCREMENT,
      \`name\` varchar(32) NOT NULL,
      \`type\` tinyint NOT NULL DEFAULT '1',
      \`path\` varchar(128) DEFAULT NULL,
      \`component\` varchar(128) DEFAULT NULL,
      \`icon\` varchar(64) DEFAULT NULL,
      \`permission\` varchar(64) DEFAULT NULL,
      \`parent_id\` int NOT NULL DEFAULT '0',
      \`sort\` int NOT NULL DEFAULT '0',
      \`status\` tinyint NOT NULL DEFAULT '1',
      \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      PRIMARY KEY (\`id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='菜单'`)
    await queryRunner.query(`INSERT INTO \`menu\` (\`id\`, \`name\`, \`type\`, \`path\`, \`component\`, \`icon\`, \`permission\`, \`parent_id\`, \`sort\`, \`status\`)
      SELECT CAST(SUBSTRING(\`id\`, 6) AS UNSIGNED), \`name\`, COALESCE(\`menu_type\`, 1), \`url\`, \`component\`, \`icon\`, \`perms\`,
             COALESCE(CAST(SUBSTRING(\`parent_id\`, 6) AS UNSIGNED), 0), COALESCE(\`sort_no\`, 0), IF(\`status\` = '1', 1, 0)
      FROM \`sys_permission\``)

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS \`dept\` (
      \`id\` int NOT NULL AUTO_INCREMENT,
      \`name\` varchar(32) NOT NULL,
      \`parent_id\` int NOT NULL DEFAULT '0',
      \`sort\` int NOT NULL DEFAULT '0',
      \`leader\` varchar(32) DEFAULT NULL,
      \`phone\` varchar(20) DEFAULT NULL,
      \`status\` tinyint NOT NULL DEFAULT '1',
      \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      PRIMARY KEY (\`id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='部门'`)
    await queryRunner.query(`INSERT INTO \`dept\` (\`id\`, \`name\`, \`parent_id\`, \`sort\`, \`leader\`, \`phone\`, \`status\`)
      SELECT CAST(SUBSTRING(\`id\`, 6) AS UNSIGNED), \`depart_name\`, COALESCE(CAST(SUBSTRING(\`parent_id\`, 6) AS UNSIGNED), 0),
             COALESCE(\`depart_order\`, 0), TRIM(REPLACE(COALESCE(\`description\`, ''), '负责人：', '')), \`mobile\`, IF(\`status\` = '1', 1, 0)
      FROM \`sys_depart\``)

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS \`user_roles\` (
      \`user_id\` varchar(32) NOT NULL,
      \`role_id\` int NOT NULL,
      PRIMARY KEY (\`user_id\`, \`role_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
    await queryRunner.query(`INSERT IGNORE INTO \`user_roles\` (\`user_id\`, \`role_id\`)
      SELECT ur.\`user_id\`, r.\`id\` FROM \`sys_user_role\` ur JOIN \`sys_role\` sr ON sr.\`id\` = ur.\`role_id\` JOIN \`role\` r ON r.\`name\` = sr.\`role_code\``)

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS \`role_menus\` (
      \`menu_id\` int NOT NULL,
      \`role_id\` int NOT NULL,
      PRIMARY KEY (\`menu_id\`, \`role_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
    await queryRunner.query(`INSERT IGNORE INTO \`role_menus\` (\`menu_id\`, \`role_id\`)
      SELECT CAST(SUBSTRING(rp.\`permission_id\`, 6) AS UNSIGNED), r.\`id\`
      FROM \`sys_role_permission\` rp JOIN \`sys_role\` sr ON sr.\`id\` = rp.\`role_id\` JOIN \`role\` r ON r.\`name\` = sr.\`role_code\``)

    await queryRunner.query("UPDATE `sys_user` SET `dept_id` = CAST(SUBSTRING(`dept_id`, 6) AS UNSIGNED) WHERE `dept_id` LIKE 'dept_%'")
    await queryRunner.query("ALTER TABLE `sys_user` MODIFY COLUMN `dept_id` int DEFAULT NULL COMMENT '所属部门ID，空为未分配（本项目扩展）'")

    await queryRunner.query('DROP TABLE IF EXISTS `sys_role_permission`')
    await queryRunner.query('DROP TABLE IF EXISTS `sys_permission`')
    await queryRunner.query('DROP TABLE IF EXISTS `sys_user_role`')
    await queryRunner.query('DROP TABLE IF EXISTS `sys_depart`')
    await queryRunner.query('DROP TABLE IF EXISTS `sys_role`')
  }
}
