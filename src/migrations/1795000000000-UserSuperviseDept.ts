import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 用户管辖部门关系表（ReBAC 轻量版）
 *
 * 背景：sys_role.data_scope 的「本部门及以下(2)/本部门(3)」此前只作用于用户列表，
 * 业务数据（customer / biz_order 没有 dept_id 列）一律保守退化为「仅本人」。
 * 本表让管理员可以显式授予用户「监管哪些部门」，业务数据的可见范围随之扩展为
 * own ∪ 被监管部门成员创建的数据。
 *
 * 设计要点：
 * - 表里存的是**已展开的有效部门 id**（ assigns 时把子孙部门一并展开写入），
 *   查询期直接用 IN，不在热路径做递归，部门树变更需重新 assign。
 * - tenant_id 参与唯一键：同一账号在不同租户可有不同监管范围；0 = 平台共享。
 * - 不新增权限点：配置入口复用 system:user:update，存量租户无需 provision-all。
 */
export class UserSuperviseDept1795000000000 implements MigrationInterface {
  name = 'UserSuperviseDept1795000000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS \`sys_user_supervise_dept\` (
        \`id\` varchar(32) NOT NULL COMMENT 'ID',
        \`user_id\` varchar(32) NOT NULL COMMENT '被授权用户ID',
        \`dept_id\` varchar(32) NOT NULL COMMENT '管辖部门ID（含展开的子孙部门）',
        \`tenant_id\` int NOT NULL DEFAULT 0 COMMENT '租户ID(0=平台级)',
        \`create_time\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_supervise_user_dept\` (\`tenant_id\`, \`user_id\`, \`dept_id\`),
        KEY \`idx_supervise_dept\` (\`dept_id\`),
        KEY \`idx_supervise_user\` (\`user_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户管辖部门关系表'`
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `sys_user_supervise_dept`')
  }
}
