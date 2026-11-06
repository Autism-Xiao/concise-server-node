import { type MigrationInterface, type QueryRunner } from 'typeorm'

/**
 * 清理软删除用户遗留的关联行
 *
 * 修复前 `UserService.delete` 只把 sys_user.del_flag 置 1，不动 sys_user_role / sys_user_depart，
 * 于是已删用户仍然「占着」角色：
 * - 角色删除保护统计关联表条数 → 提示「还有 N 个用户」，但界面上那个用户根本不存在 → 角色永久删不掉；
 * - 关联行随删除次数无限累积。
 *
 * 代码已经改成软删时同步清理，这个迁移只负责把历史脏数据扫一遍（幂等，重复执行无副作用）。
 */
export class CleanupSoftDeletedUserRelations1794000000000 implements MigrationInterface {
  name = 'CleanupSoftDeletedUserRelations1794000000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DELETE ur FROM sys_user_role ur INNER JOIN sys_user u ON u.id = ur.user_id WHERE u.del_flag = 1')
    await queryRunner.query('DELETE ud FROM sys_user_depart ud INNER JOIN sys_user u ON u.id = ud.user_id WHERE u.del_flag = 1')
  }

  public async down(): Promise<void> {
    // 数据清理类迁移不做回滚：已删用户的历史角色/部门分配关系没有保留价值，也无法还原
  }
}
