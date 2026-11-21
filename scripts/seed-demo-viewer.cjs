/**
 * 演示只读账号 seed（幂等，可重复执行）
 *
 * 造一个「只能看、不能改」的演示账号，用于把系统给外人演示：
 *   账号 demo_viewer / Demo@123456，落在深圳示范科技（demo_sz）租户，绑 viewer 只读模板角色。
 *
 * 依赖：先跑过 scripts/seed-tenant-demo.cjs（demo_sz 租户存在）；
 *       viewer 角色由 tenant provision 服务保证（本脚本会先补跑一次 provision）。
 *
 * 用法：npm run build; node scripts/seed-tenant-demo.cjs; node scripts/seed-demo-viewer.cjs
 */
;(async () => {
  const { NestFactory } = require('@nestjs/core')
  const { AppModule } = require('../dist/app.module')
  const { getDataSourceToken } = require('@nestjs/typeorm')
  const { hashPassword } = require('../dist/utils/password.util')

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] })
  const ds = app.get(getDataSourceToken('default'))
  const provision = app.get(require('../dist/modules/system/tenant/tenant-provision.service').TenantProvisionService)

  const USERNAME = 'demo_viewer'
  const PASSWORD = 'Demo@123456'

  // 1. demo_sz 租户必须存在（seed-tenant-demo 的产物）
  const tenants = await ds.query('SELECT id, name, code FROM sys_tenant WHERE code = ? AND del_flag = 0', ['demo_sz'])
  if (!tenants.length) {
    console.error('未找到演示租户 demo_sz —— 请先执行：node scripts/seed-tenant-demo.cjs')
    process.exit(1)
  }
  const tenant = tenants[0]

  // 2. 补跑 provision：保证该租户有 viewer 模板角色（幂等，补缺不重建）
  await provision.provisionAll()

  const roles = await ds.query('SELECT id FROM sys_role WHERE tenant_id = ? AND role_code = ?', [tenant.id, 'viewer'])
  if (!roles.length) {
    console.error(`租户 ${tenant.id} 下没有 viewer 角色（provision 失败？）`)
    process.exit(1)
  }

  // 3. 建用户（幂等：已存在则跳过创建，密码不覆盖 —— 免得演示现场被人改过密码后 seed 又把它抹回去）
  const existing = await ds.query('SELECT id FROM sys_user WHERE username = ? AND del_flag = 0', [USERNAME])
  let userId = existing[0]?.id
  if (!userId) {
    userId = require('../dist/utils/password.util').randomId32()
    await ds.query(
      `INSERT INTO sys_user (id, username, password, realname, status, del_flag, is_platform_admin, create_time)
       VALUES (?, ?, ?, ?, 1, 0, 0, NOW())`,
      [userId, USERNAME, await hashPassword(PASSWORD), '演示访客']
    )
    console.log(`已创建用户 ${USERNAME}`)
  }

  // 4. 绑定角色与租户（幂等：查到就跳过；sys_user_role 自带 tenant_id 列，按租户划归）
  const hasRole = await ds.query('SELECT 1 AS one FROM sys_user_role WHERE user_id = ? AND role_id = ?', [userId, roles[0].id])
  if (!hasRole.length) {
    await ds.query('INSERT INTO sys_user_role (user_id, role_id, tenant_id) VALUES (?, ?, ?)', [userId, roles[0].id, tenant.id])
  }
  const hasTenant = await ds.query('SELECT 1 AS one FROM sys_user_tenant WHERE user_id = ? AND tenant_id = ?', [userId, tenant.id])
  if (!hasTenant.length) {
    await ds.query('INSERT INTO sys_user_tenant (user_id, tenant_id, status, create_time) VALUES (?, ?, 0, NOW())', [userId, tenant.id])
  }

  console.log('\n=== 演示只读账号就绪 ===')
  console.log(`登录地址：/login`)
  console.log(`账号：${USERNAME}`)
  console.log(`密码：${PASSWORD}`)
  console.log(`租户：${tenant.name}（${tenant.code}）  角色：viewer（只读）`)
  await app.close()
})().catch(error => {
  console.error(error)
  process.exit(1)
})
