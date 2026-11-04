import { type MigrationInterface, type QueryRunner } from 'typeorm'

/** 工具菜单按钮权限点 */
const BUTTONS: Array<{ name: string; permission: string }> = [
  { name: '文件上传', permission: 'tools:upload' },
  { name: '存储查询', permission: 'tools:storage:list' },
  { name: '存储删除', permission: 'tools:storage:delete' }
]

/**
 * 工具模块迁移：创建 tool_storage 表 + 录入存储管理菜单与按钮权限
 * 幂等设计：表用 CREATE TABLE IF NOT EXISTS，菜单/按钮按 name+type / permission 判重
 */
export class Migration1793761636411 implements MigrationInterface {
  name = 'Migration1793761636411'

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. 存储记录表
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS \`tool_storage\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`name\` varchar(200) NOT NULL COMMENT '文件名',
        \`file_name\` varchar(200) NULL COMMENT '真实文件名',
        \`ext_name\` varchar(32) NULL COMMENT '扩展名',
        \`path\` varchar(255) NOT NULL COMMENT '访问路径',
        \`type\` varchar(16) NULL COMMENT '文件类型',
        \`size\` varchar(32) NULL COMMENT '文件大小',
        \`user_id\` int NULL COMMENT '上传用户ID',
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB`
    )

    // 2. 确保系统管理目录存在
    let sysId = await this.findId(queryRunner, '系统管理', 0)
    if (!sysId) {
      await queryRunner.query(
        `INSERT INTO menu (name, type, path, icon, parentId, sort, status, created_at, updated_at)
         VALUES ('系统管理', 0, '/system', 'setting', 0, 1, 1, NOW(6), NOW(6))`
      )
      sysId = await this.findId(queryRunner, '系统管理', 0)
    }
    if (!sysId) {
      throw new Error('系统管理目录创建失败')
    }

    // 3. 存储管理菜单
    let menuId = await this.findId(queryRunner, '存储管理', 1)
    if (!menuId) {
      await queryRunner.query(
        `INSERT INTO menu (name, type, path, component, icon, parentId, sort, status, created_at, updated_at)
         VALUES ('存储管理', 1, '/tools/storage', 'tools/storage/index', 'storage', ?, 7, 1, NOW(6), NOW(6))`,
        [sysId]
      )
      menuId = await this.findId(queryRunner, '存储管理', 1)
    }
    if (!menuId) {
      throw new Error('存储管理菜单创建失败')
    }

    // 4. 按钮权限
    for (const [index, button] of BUTTONS.entries()) {
      const exists = await queryRunner.query(`SELECT id FROM menu WHERE permission = ? LIMIT 1`, [button.permission])
      if (exists.length > 0) {
        continue
      }
      await queryRunner.query(
        `INSERT INTO menu (name, type, permission, parentId, sort, status, created_at, updated_at)
         VALUES (?, 2, ?, ?, ?, 1, NOW(6), NOW(6))`,
        [button.name, button.permission, menuId, index + 1]
      )
    }
  }

  /** 回滚：删除按钮权限记录与 tool_storage 表；菜单本身保留 */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const permissions = BUTTONS.map(button => button.permission)
    await queryRunner.query(`DELETE FROM menu WHERE type = 2 AND permission IN (?)`, [permissions])
    await queryRunner.query(`DROP TABLE IF EXISTS \`tool_storage\``)
  }

  /** 按名称与类型查菜单 ID */
  private async findId(queryRunner: QueryRunner, name: string, type: number): Promise<number | null> {
    const rows: Array<{ id: number }> = await queryRunner.query(`SELECT id FROM menu WHERE name = ? AND type = ? ORDER BY id ASC LIMIT 1`, [name, type])
    return rows.length > 0 ? rows[0].id : null
  }
}
