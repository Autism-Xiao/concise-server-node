import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 记住登录凭证（方案 C）开关：
 *
 * feature.auth.rememberMe —— 登录页「记住登录」改为 Redis 凭证免密续登。
 * 勾选后服务端签发随机凭证（Redis 只存 token 的 SHA-256 与 refresh 链头，不存任何密码形态），
 * 下次进登录页凭凭证 + 设备绑定换取新令牌对；改密/重置密码/封号触发的全量下线会让凭证随之失效。
 * 默认开启（'1'）；关闭后不再签发，存量凭证的换取也会被拒（fail-safe）。
 * 存量行为：不勾选时登录流程与旧版完全一致。
 */
export class FeatureRememberMe1795020000000 implements MigrationInterface {
  name = 'FeatureRememberMe1795020000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO sys_config (config_key, config_value, value_type, config_group, name, remark, is_builtin, allow_tenant, del_flag, created_at, updated_at) VALUES
        ('feature.auth.rememberMe', '1', 'boolean', 'feature', '记住登录凭证',
         '登录页「记住登录」改为服务端 Redis 凭证免密续登；关闭后不再签发且存量凭证失效；按租户可覆盖', 1, 1, 0, NOW(), NOW())`
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DELETE FROM `sys_config` WHERE `config_key` = 'feature.auth.rememberMe'")
  }
}
