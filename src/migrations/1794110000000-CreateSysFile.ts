import { type MigrationInterface, type QueryRunner } from 'typeorm'

/**
 * 文件管理表 sys_file：文件夹与文件同表（is_folder 区分），parent_id 建目录树
 *
 * 关键设计：
 *  - size 用 BIGINT 存字节数（旧的 tool_storage 存的是 "23.4 KB" 字符串，没法统计/排序）
 *  - storage_key 指向内容寻址的物理路径（storage/files/yyyy/MM/{sha256}.{ext}），
 *    改名/移动只改这张表，磁盘不动
 *  - 软删（is_deleted + deleted_at）支撑回收站；物理文件在「彻底删除」时才清理
 *  - 显式 COLLATE=utf8mb4_unicode_ci：与 sys_user / sys_region 等存量表一致，
 *    避免 DEFAULT 0900_ai_ci 在 JOIN 时报 Illegal mix of collations
 *
 * 刻意不加 (owner_id, parent_id, name) 唯一索引：软删后同名会与回收站里的记录冲突，
 * 重名检查放在服务层做（并发重名可接受，真实文件系统也会出现同名文件）。
 */
export class CreateSysFile1794110000000 implements MigrationInterface {
  name = 'CreateSysFile1794110000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`sys_file\` (
        \`id\` INT NOT NULL AUTO_INCREMENT COMMENT '主键',
        \`parent_id\` INT NOT NULL DEFAULT 0 COMMENT '父目录ID(0=根目录)',
        \`name\` VARCHAR(255) NOT NULL COMMENT '显示名称',
        \`is_folder\` TINYINT NOT NULL DEFAULT 0 COMMENT '是否文件夹',
        \`ext\` VARCHAR(32) NOT NULL DEFAULT '' COMMENT '扩展名',
        \`mime\` VARCHAR(120) NOT NULL DEFAULT '' COMMENT 'MIME类型',
        \`size\` BIGINT NOT NULL DEFAULT 0 COMMENT '字节数',
        \`storage_key\` VARCHAR(255) NOT NULL DEFAULT '' COMMENT '物理相对路径',
        \`hash\` CHAR(64) NOT NULL DEFAULT '' COMMENT 'sha256',
        \`owner_id\` VARCHAR(32) NOT NULL DEFAULT '' COMMENT '所有者用户ID',
        \`dept_id\` INT NOT NULL DEFAULT 0 COMMENT '所属部门ID',
        \`is_starred\` TINYINT NOT NULL DEFAULT 0 COMMENT '是否星标',
        \`is_deleted\` TINYINT NOT NULL DEFAULT 0 COMMENT '是否已删除',
        \`deleted_at\` DATETIME NULL COMMENT '删除时间',
        \`sort_order\` INT NOT NULL DEFAULT 0 COMMENT '排序',
        \`remark\` VARCHAR(255) NOT NULL DEFAULT '' COMMENT '备注',
        \`create_time\` DATETIME NULL COMMENT '创建时间',
        \`update_time\` DATETIME NULL COMMENT '更新时间',
        PRIMARY KEY (\`id\`),
        KEY \`idx_sys_file_owner_parent\` (\`owner_id\`, \`parent_id\`, \`is_deleted\`),
        KEY \`idx_sys_file_owner_deleted_update\` (\`owner_id\`, \`is_deleted\`, \`update_time\`),
        KEY \`idx_sys_file_hash\` (\`hash\`),
        KEY \`idx_sys_file_storage_key\` (\`storage_key\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文件管理'
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `sys_file`')
  }
}
