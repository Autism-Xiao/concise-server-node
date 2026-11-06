import { type MigrationInterface, type QueryRunner } from 'typeorm'

/**
 * 用户管理 PRD 落地：密码策略 + 数据权限 + 用户↔岗位关联
 *
 *  - sys_user.password_expire_at / must_change_password：密码有效期与「下次登录强制改密」，
 *    到期后登录照常放行，但登录响应带 mustChangePassword=true，由前端拦住强制改密后才能进系统
 *  - sys_role.data_scope：数据范围（1 全部 / 2 本部门及以下 / 3 本部门 / 4 仅本人），
 *    默认 1（全部），与改造前行为一致，不影响的存量角色
 *  - sys_user_post：用户↔岗位多对多（对齐 JeecgBoot sys_user_post），岗位本体 sys_position 已存在
 */
export class UserSecurityAndScope1794080000000 implements MigrationInterface {
  name = 'UserSecurityAndScope1794080000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`sys_user\`
        ADD COLUMN \`password_expire_at\` DATETIME NULL COMMENT '密码过期时间(空=不限制)' AFTER \`salt\`,
        ADD COLUMN \`must_change_password\` TINYINT NOT NULL DEFAULT 0 COMMENT '下次登录强制改密(1是 0否)' AFTER \`password_expire_at\`
    `)

    await queryRunner.query(`
      ALTER TABLE \`sys_role\`
        ADD COLUMN \`data_scope\` TINYINT NOT NULL DEFAULT 1 COMMENT '数据范围(1全部 2本部门及以下 3本部门 4仅本人)' AFTER \`role_code\`
    `)

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`sys_user_post\` (
        \`user_id\` VARCHAR(32) NOT NULL COMMENT '用户ID',
        \`post_id\` VARCHAR(32) NOT NULL COMMENT '岗位ID(sys_position.id)',
        PRIMARY KEY (\`user_id\`, \`post_id\`),
        INDEX \`idx_user_post_post\` (\`post_id\`),
        CONSTRAINT \`fk_user_post_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`sys_user\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`fk_user_post_post\` FOREIGN KEY (\`post_id\`) REFERENCES \`sys_position\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户-岗位关联'
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `sys_user_post`')
    await queryRunner.query('ALTER TABLE `sys_role` DROP COLUMN `data_scope`')
    await queryRunner.query('ALTER TABLE `sys_user` DROP COLUMN `must_change_password`, DROP COLUMN `password_expire_at`')
  }
}
