import { type MigrationInterface, type QueryRunner } from 'typeorm'

/**
 * 给存量用户补齐界面设置行
 *
 * 背景：`sys_user_setting` 原来是懒创建 —— 只有用户登录后在前端点一次「保存设置」才会 upsert。
 * 结果是库里「用户表 4 行、设置表 2 行」，管理员在后台看不出这个账号有没有偏好，
 * 也看不出是新账号还是漏数据。
 *
 * 本次改造把建行时机前移到「创建用户」（`UserSettingService.ensure()`），本迁移负责把
 * 已经存在的历史用户一次补上，让两张表口径一致。
 *
 * 存 `'{}'` 而不是完整默认值：默认值随前端迭代会变，固化成具体值会让老用户永远停在旧默认。
 * `update_time` 留 NULL 表示「从未修改过」。软删（`del_flag = 1`）的账号不补 ——
 * 从回收站恢复时 `UserService.restore()` 会调 `ensure()` 重建。
 */
export class BackfillUserSetting1794250000000 implements MigrationInterface {
  name = 'BackfillUserSetting1794250000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    // INSERT IGNORE + SELECT：已经有设置行的用户原样跳过，绝不覆盖真实偏好
    await queryRunner.query(`
      INSERT IGNORE INTO \`sys_user_setting\` (\`user_id\`, \`settings\`, \`update_time\`)
      SELECT \`id\`, '{}', NULL FROM \`sys_user\` WHERE \`del_flag\` = 0
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 只回收「本迁移 / ensure() 造出来的空行」：用户真改过设置后 update_time 一定不为 NULL
    // （save() 每次都写 update_time），所以这个条件不会误删用户数据
    await queryRunner.query("DELETE FROM `sys_user_setting` WHERE `settings` = '{}' AND `update_time` IS NULL")
  }
}
