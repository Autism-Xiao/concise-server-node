import { type MigrationInterface, type QueryRunner } from 'typeorm'

/**
 * 多租户（对齐 JeecgBoot sys_tenant / sys_user_tenant）
 *
 * 租户模型：
 *  - sys_tenant 租户档案（编码唯一、套餐、到期日、状态）
 *  - sys_user_tenant 用户与租户多对多（一个账号可属多个租户，登录后可切换）
 *  - 业务表带 tenant_id 做行级隔离；`tenant_id = 0` 表示「平台共享」数据，所有租户可见
 *
 * 隔离范围的取舍：
 *  - 隔离：部门、角色、字典、公告、任务、文件、职级、岗位（都是租户自有数据）
 *  - 不隔离：sys_user（账号全局，靠 sys_user_tenant 归属）、sys_permission（菜单权限全局）、
 *    sys_region / sys_log / sys_quartz_job（基础数据与平台运维）
 *
 * 存量数据全部归到默认租户 1（平台租户），保证升级后现有账号立即可用。
 */
export class CreateTenantTables1794120000000 implements MigrationInterface {
  name = 'CreateTenantTables1794120000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- 1. 租户档案 ----
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`sys_tenant\` (
        \`id\` INT NOT NULL AUTO_INCREMENT COMMENT '主键',
        \`name\` VARCHAR(100) NOT NULL COMMENT '租户名称',
        \`code\` VARCHAR(64) NOT NULL COMMENT '租户编码(唯一)',
        \`contact\` VARCHAR(50) NOT NULL DEFAULT '' COMMENT '联系人',
        \`phone\` VARCHAR(30) NOT NULL DEFAULT '' COMMENT '联系电话',
        \`plan\` VARCHAR(20) NOT NULL DEFAULT 'standard' COMMENT '套餐:trial/standard/enterprise',
        \`begin_date\` DATE NULL COMMENT '开通日期',
        \`expire_at\` DATE NULL COMMENT '到期日期',
        \`status\` TINYINT NOT NULL DEFAULT 0 COMMENT '状态:0正常 1停用',
        \`remark\` VARCHAR(255) NOT NULL DEFAULT '' COMMENT '备注',
        \`del_flag\` TINYINT NOT NULL DEFAULT 0 COMMENT '删除标记:0正常 1已删除',
        \`create_by\` VARCHAR(32) NULL COMMENT '创建人',
        \`create_time\` DATETIME NULL COMMENT '创建时间',
        \`update_by\` VARCHAR(32) NULL COMMENT '更新人',
        \`update_time\` DATETIME NULL COMMENT '更新时间',
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uniq_sys_tenant_code\` (\`code\`),
        KEY \`idx_sys_tenant_status\` (\`status\`, \`del_flag\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='租户'
    `)

    // ---- 2. 用户-租户关系 ----
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`sys_user_tenant\` (
        \`id\` INT NOT NULL AUTO_INCREMENT COMMENT '主键',
        \`user_id\` VARCHAR(32) NOT NULL COMMENT '用户ID',
        \`tenant_id\` INT NOT NULL COMMENT '租户ID',
        \`status\` TINYINT NOT NULL DEFAULT 0 COMMENT '状态:0正常 1停用',
        \`create_time\` DATETIME NULL COMMENT '创建时间',
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uniq_sys_user_tenant\` (\`user_id\`, \`tenant_id\`),
        KEY \`idx_sys_user_tenant_tenant\` (\`tenant_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户-租户关系'
    `)

    // ---- 3. 默认租户 + 存量数据归属 ----
    await queryRunner.query(`
      INSERT INTO \`sys_tenant\` (\`id\`, \`name\`, \`code\`, \`contact\`, \`plan\`, \`begin_date\`, \`expire_at\`, \`status\`, \`remark\`, \`create_time\`)
      VALUES (1, '平台默认租户', 'default', '管理员', 'enterprise', CURDATE(), NULL, 0, '系统初始化租户，升级前的存量数据都归属这里', NOW())
      ON DUPLICATE KEY UPDATE \`name\` = VALUES(\`name\`)
    `)

    // 存量账号全部加入默认租户（登录后即可正常进入）
    await queryRunner.query(`
      INSERT IGNORE INTO \`sys_user_tenant\` (\`user_id\`, \`tenant_id\`, \`status\`, \`create_time\`)
      SELECT \`id\`, 1, 0, NOW() FROM \`sys_user\` WHERE \`del_flag\` = 0
    `)

    // ---- 4. 业务表补 tenant_id ----
    // 已存在的 sys_depart.tenant_id / sys_role.tenant_id 是 jeecg 原生列，这里只回填存量值
    await queryRunner.query('UPDATE `sys_depart` SET `tenant_id` = 1 WHERE `tenant_id` IS NULL OR `tenant_id` = 0')
    await queryRunner.query('UPDATE `sys_role` SET `tenant_id` = 1 WHERE `tenant_id` IS NULL OR `tenant_id` = 0')

    const tables = [
      { table: 'sys_dict', comment: '字典类型' },
      { table: 'sys_dict_item', comment: '字典项' },
      { table: 'sys_announcement', comment: '通知公告' },
      { table: 'task', comment: '任务' },
      { table: 'sys_file', comment: '文件管理' },
      { table: 'sys_level', comment: '职级' },
      { table: 'sys_position', comment: '岗位' }
    ]
    for (const { table, comment } of tables) {
      const exists = await this.hasColumn(queryRunner, table, 'tenant_id')
      if (!exists) {
        await queryRunner.query(`ALTER TABLE \`${table}\` ADD COLUMN \`tenant_id\` INT NOT NULL DEFAULT 1 COMMENT '租户ID(0=平台共享)' AFTER \`id\``)
      }
      await queryRunner.query(`UPDATE \`${table}\` SET \`tenant_id\` = 1 WHERE \`tenant_id\` = 0`)
      // 索引名按表命名，避免不同表重名冲突
      const indexName = `idx_${table}_tenant`
      const hasIndex = await this.hasIndex(queryRunner, table, indexName)
      if (!hasIndex) {
        await queryRunner.query(`ALTER TABLE \`${table}\` ADD KEY \`${indexName}\` (\`tenant_id\`)`)
      }
      void comment
    }

    // sys_depart / sys_role 的 tenant_id 是 jeecg 旧列，可能没有索引，补一个
    for (const table of ['sys_depart', 'sys_role']) {
      const indexName = `idx_${table}_tenant`
      if (!(await this.hasIndex(queryRunner, table, indexName))) {
        await queryRunner.query(`ALTER TABLE \`${table}\` ADD KEY \`${indexName}\` (\`tenant_id\`)`)
      }
    }

    // ---- 5. 租户管理的按钮权限 ----
    // 租户管理菜单（menu_44）原本没有按钮节点，前端拿不到 system:tenant:* 就永远隐藏按钮
    const buttons = [
      { id: 'menu_tnt_list', name: '查询租户', perms: 'system:tenant:list', sort: 1 },
      { id: 'menu_tnt_add', name: '新增租户', perms: 'system:tenant:add', sort: 2 },
      { id: 'menu_tnt_edit', name: '编辑租户', perms: 'system:tenant:edit', sort: 3 },
      { id: 'menu_tnt_del', name: '删除租户', perms: 'system:tenant:delete', sort: 4 },
      { id: 'menu_tnt_user', name: '分配用户', perms: 'system:tenant:user', sort: 5 }
    ]
    for (const button of buttons) {
      await queryRunner.query(
        `INSERT INTO \`sys_permission\` (\`id\`, \`parent_id\`, \`name\`, \`menu_type\`, \`perms\`, \`perms_type\`, \`sort_no\`, \`del_flag\`, \`status\`, \`create_time\`)
         VALUES (?, 'menu_44', ?, 2, ?, '1', ?, 0, '1', NOW())
         ON DUPLICATE KEY UPDATE \`perms\` = VALUES(\`perms\`), \`del_flag\` = 0, \`status\` = '1'`,
        [button.id, button.name, button.perms, button.sort]
      )
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['sys_dict', 'sys_dict_item', 'sys_announcement', 'task', 'sys_file', 'sys_level', 'sys_position']) {
      if (await this.hasIndex(queryRunner, table, `idx_${table}_tenant`)) {
        await queryRunner.query(`ALTER TABLE \`${table}\` DROP KEY \`idx_${table}_tenant\``)
      }
      if (await this.hasColumn(queryRunner, table, 'tenant_id')) {
        await queryRunner.query(`ALTER TABLE \`${table}\` DROP COLUMN \`tenant_id\``)
      }
    }
    await queryRunner.query('DROP TABLE IF EXISTS `sys_user_tenant`')
    await queryRunner.query('DROP TABLE IF EXISTS `sys_tenant`')
  }

  /** 列是否存在（information_schema 查询，避免重复 ALTER 报错） */
  private async hasColumn(queryRunner: QueryRunner, table: string, column: string): Promise<boolean> {
    const rows: { cnt: number }[] = await queryRunner.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column]
    )
    return Number(rows[0]?.cnt ?? 0) > 0
  }

  /** 索引是否存在 */
  private async hasIndex(queryRunner: QueryRunner, table: string, indexName: string): Promise<boolean> {
    const rows: { cnt: number }[] = await queryRunner.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
      [table, indexName]
    )
    return Number(rows[0]?.cnt ?? 0) > 0
  }
}
