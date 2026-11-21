import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 租户级特性开关（Feature Flags）前两个开关：
 *
 * feature.log.maskSensitive —— 操作日志敏感参数脱敏。
 * 开启后 OperLogInterceptor 落库 params 前，会把手机号/金额等敏感键值与
 * 11 位手机号形态的字符串打码，堵住 P1 字段脱敏后 sys_log.params 仍留明文的旁路。
 * 默认关闭（'0'）：存量租户行为不变，平台/租户可在参数配置里按需开启（allow_tenant=1）。
 *
 * feature.rbac.superviseDept —— 监管部门数据权限（ReBAC）开关。
 * 默认开启（'1'）：存量行为不变；作为租户级 kill switch，关闭后
 * GET/PUT /v1/users/:id/supervise-depts 整体 403，配置入口同时下线。
 *
 * 之后新增开关 = 在参数配置加一行 `feature.xxx`（allow_tenant=1）+ 代码侧消费，零迁移。
 */
export class FeatureFlags1795010000000 implements MigrationInterface {
  name = 'FeatureFlags1795010000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO sys_config (config_key, config_value, value_type, config_group, name, remark, is_builtin, allow_tenant, del_flag, created_at, updated_at) VALUES
        ('feature.log.maskSensitive', '0', 'boolean', 'feature', '操作日志敏感参数脱敏',
         '开启后操作日志 params 中的手机号/金额等敏感值打码落库；按租户可覆盖', 1, 1, 0, NOW(), NOW()),
        ('feature.rbac.superviseDept', '1', 'boolean', 'feature', '监管部门数据权限',
         '关闭后监管部门的查看与配置接口整体停用（kill switch）；按租户可覆盖', 1, 1, 0, NOW(), NOW())`
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DELETE FROM `sys_config` WHERE `config_key` IN ('feature.log.maskSensitive', 'feature.rbac.superviseDept')")
  }
}
