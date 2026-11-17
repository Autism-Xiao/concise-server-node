import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 功能套餐表 sys_tenant_menu：租户 → 已开通的租户级菜单（scope='tenant'）
 *
 * 背景：「平台超管 / 租户管理员」双角色规范中的「可选菜单受限于该租户买的套餐」。
 * 在这张表出现之前，租户管理员在角色授权里可以把全库任意租户级菜单授给自己的角色
 * （assignMenus 只拦 scope='platform'），等于用不到的模块也能自己开通——套餐形同虚设。
 *
 * 语义：
 * - 表里**没有**某租户的行/行很少 → 该租户可授权的菜单集合（空 = 无可授权，不会回退成全量）
 * - 授权端（RoleService.assignMenus）与菜单树端（auth.getPermissionInfo）两端都取交集
 * - 开通/初始化租户（TenantProvisionService.provisionIn）会按「角色应得菜单的并集」补齐本表，
 *   只增不减：平台新增租户级菜单跑 provision-all 后套餐自动扩容
 *
 * 回填：每个租户取其**全部角色已授权菜单的并集**（不含 platform 级），存量行为完全不变。
 */
export class Migration1794910000000 implements MigrationInterface {
  name = 'Migration1794910000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS \`sys_tenant_menu\` (
      \`id\` varchar(32) NOT NULL COMMENT '主键id',
      \`tenant_id\` int NOT NULL COMMENT '租户ID',
      \`permission_id\` varchar(32) NOT NULL COMMENT '菜单ID(sys_permission.id)',
      \`create_time\` datetime NULL COMMENT '创建时间',
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`uk_tenant_menu\` (\`tenant_id\`, \`permission_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='租户功能套餐(已开通菜单)'`)

    // 回填存量：租户角色已授权菜单的并集。INSERT IGNORE 兜住 (tenant_id, permission_id) 唯一键冲突。
    // 注意 sys_role 无 del_flag（角色是硬删除），不过滤 status：停用角色的授权仍是租户"买过"的功能。
    await queryRunner.query(`INSERT IGNORE INTO \`sys_tenant_menu\` (\`id\`, \`tenant_id\`, \`permission_id\`, \`create_time\`)
      SELECT REPLACE(UUID(), '-', ''), r.tenant_id, rp.permission_id, NOW()
        FROM sys_role_permission rp
        JOIN sys_role r ON r.id = rp.role_id AND r.tenant_id > 0
        JOIN sys_permission p ON p.id = rp.permission_id AND p.del_flag = 0 AND p.scope = 'tenant'
       GROUP BY r.tenant_id, rp.permission_id`)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `sys_tenant_menu`')
  }
}
