import { type MigrationInterface, type QueryRunner } from 'typeorm'

/**
 * 千万级用户性能补齐：列表/搜索走索引
 *
 * 背景见 docs/2026-11-09-千万级用户性能评估.md：
 *  - `sys_user` 只有 `del_flag`、`status` 这类低基数单列索引，
 *    `WHERE del_flag = 0 ORDER BY create_time DESC LIMIT 10` 在 1000 万行下实测 > 90 秒（filesort 全表）；
 *    补 `(del_flag, create_time)` 后 0.9ms。
 *  - 关键字搜索原来三列 `LIKE '%kw%'` 全表扫（> 120 秒），改前缀 `LIKE 'kw%'` 后需要
 *    `realname` 上的索引（username/phone 已有唯一索引可复用），补 `(del_flag, realname)`。
 *
 * 为什么写成「先查 information_schema 再建」：MySQL 8 没有 `CREATE INDEX IF NOT EXISTS`，
 * 而线上库可能已人工加过同名索引；迁移必须是可重复执行的，否则半路失败后重跑会直接报 duplicate key。
 */
const INDEXES: Array<{ table: string; name: string; columns: string; comment: string }> = [
  {
    table: 'sys_user',
    name: 'idx_user_del_create',
    columns: '`del_flag`, `create_time`',
    comment: '用户列表默认排序（软删过滤 + 创建时间倒序），千万行下把 filesort 变成索引扫描'
  },
  {
    table: 'sys_user',
    name: 'idx_user_del_realname',
    columns: '`del_flag`, `realname`',
    comment: '用户搜索按真实姓名前缀匹配'
  },
  {
    table: 'sys_user_depart',
    name: 'idx_sud_dep_user',
    columns: '`dep_id`, `user_id`',
    comment: '按部门筛人（EXISTS 子查询）走覆盖索引，不再回表'
  }
]

export class PerfIndexes1794230000000 implements MigrationInterface {
  name = 'PerfIndexes1794230000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const index of INDEXES) {
      if (await this.hasIndex(queryRunner, index.table, index.name)) {
        continue
      }
      // 不写 ALGORITHM/LOCK：MySQL 8 对普通二级索引默认就走 Online DDL（INPLACE + LOCK=NONE），
      // 建索引期间表仍可读写；显式写这两个子句反而对语法位置敏感（COMMENT/逗号顺序都踩过）。
      await queryRunner.query(`CREATE INDEX \`${index.name}\` ON \`${index.table}\` (${index.columns}) COMMENT '${index.comment}'`)
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const index of INDEXES) {
      if (!(await this.hasIndex(queryRunner, index.table, index.name))) {
        continue
      }
      await queryRunner.query(`DROP INDEX \`${index.name}\` ON \`${index.table}\``)
    }
  }

  /** 索引是否已存在（按库名 + 表名 + 索引名精确判断，同名索引在不同表上是合法的） */
  private async hasIndex(queryRunner: QueryRunner, table: string, name: string): Promise<boolean> {
    const rows: unknown[] = await queryRunner.query(
      'SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1',
      [table, name]
    )
    return rows.length > 0
  }
}
