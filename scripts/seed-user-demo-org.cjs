/**
 * 用户管理演示数据脚本（幂等，可重复执行）
 *
 * 目的：用户管理列表要展示「角色/职级/岗位/部门」四列，按演示截图补齐缺失的基础数据：
 * - 职级：总经理助理（并把 副总经理/总经理 的 level_rank 顺延，保证数字越大级别越高）
 * - 岗位：算法工程师 / 软件工程设计师 / 网络工程师
 * - 部门：南山区研发中心 / 罗湖区研发中心（挂总公司 dept_1 下，org_code 取 A01 下未占用号段）
 *
 * 幂等策略：按业务唯一键（level_name / post_code / 部门名+父部门）判断，
 * 存在则跳过（职级/岗位顺带把排序刷新到期望值），缺失才插入 —— 「有的话不用加，没有的话添加」。
 * 顺带清理多租户冒烟测试残留的 smoke_父部门/子部门（仅删名字以 smoke_ 开头的测试部门）。
 *
 * 用法：先 npm run build，再 node scripts/seed-user-demo-org.cjs
 */
;(async () => {
  const { NestFactory } = require('@nestjs/core')
  const { AppModule } = require('../dist/app.module')
  const { getDataSourceToken } = require('@nestjs/typeorm')

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false })
  const ds = app.get(getDataSourceToken('default'))
  const OPERATOR = 'seed'

  /** 职级：截图演示数据里多一个「总经理助理」，级别介于部门经理与副总经理之间 */
  const LEVELS = [
    { name: '员工', rank: 1 },
    { name: '小组长', rank: 2 },
    { name: '部门经理', rank: 3 },
    { name: '总经理助理', rank: 4 },
    { name: '副总经理', rank: 5 },
    { name: '总经理', rank: 6 }
  ]

  /** 部门：截图演示数据里的两个研发中心，挂在总公司（dept_1）下；org_code 取 A01 下未占用号段 */
  const DEPTS = [
    { id: 'dept_ns_rnd', name: '南山区研发中心', orgCode: 'A01A05', parent: 'dept_1' },
    { id: 'dept_lh_rnd', name: '罗湖区研发中心', orgCode: 'A01A04', parent: 'dept_1' }
  ]

  /** 岗位：截图演示数据里的三个技术岗，分别挂在两个研发中心下 */
  const POSTS = [
    { code: 'algorithm_engineer', name: '算法工程师', sort: 6, deptName: '南山区研发中心' },
    { code: 'software_design_engineer', name: '软件工程设计师', sort: 7, deptName: '南山区研发中心' },
    { code: 'network_engineer', name: '网络工程师', sort: 8, deptName: '罗湖区研发中心' }
  ]

  /* ---------- 1. 职级（存在只刷新排序，缺失才插入） ---------- */
  let levelInserted = 0
  for (const level of LEVELS) {
    const exists = await ds.query('SELECT id FROM sys_level WHERE level_name = ?', [level.name])
    if (exists.length) {
      await ds.query('UPDATE sys_level SET level_rank = ?, update_by = ?, update_time = NOW() WHERE id = ?', [level.rank, OPERATOR, exists[0].id])
    } else {
      await ds.query('INSERT INTO sys_level (id, level_name, level_rank, status, create_by, create_time, tenant_id) VALUES (?, ?, ?, ?, ?, NOW(), 1)', [
        `lvl_demo_${level.rank}`,
        level.name,
        level.rank,
        '1',
        OPERATOR
      ])
      levelInserted++
    }
  }

  /* ---------- 2. 部门（父部门 + org_code 都一致才算同一条） ---------- */
  let deptInserted = 0
  for (const dept of DEPTS) {
    const parent = await ds.query("SELECT id, org_code FROM sys_depart WHERE id = ? AND (del_flag IS NULL OR del_flag <> '1')", [dept.parent])
    if (!parent.length) {
      console.warn(`跳过部门「${dept.name}」：父部门 ${dept.parent} 不存在`)
      continue
    }
    // org_code 被别的部门占用才算冲突；被自己占用（上次跑到一半）则走下面的名字判断
    const codeTaken = await ds.query('SELECT id FROM sys_depart WHERE org_code = ? AND depart_name <> ?', [dept.orgCode, dept.name])
    if (codeTaken.length) {
      console.warn(`跳过部门「${dept.name}」：org_code ${dept.orgCode} 已被占用`)
      continue
    }
    const exists = await ds.query("SELECT id FROM sys_depart WHERE depart_name = ? AND parent_id = ? AND (del_flag IS NULL OR del_flag <> '1')", [
      dept.name,
      dept.parent
    ])
    if (exists.length) continue

    await ds.query(
      "INSERT INTO sys_depart (id, parent_id, depart_name, org_code, org_category, depart_order, status, del_flag, create_by, create_time, tenant_id, iz_leaf) VALUES (?, ?, ?, ?, '1', 0, '1', '0', ?, NOW(), 1, 1)",
      [dept.id, dept.parent, dept.name, dept.orgCode, OPERATOR]
    )
    // 父部门从「叶子」变「有子级」
    await ds.query('UPDATE sys_depart SET iz_leaf = 0 WHERE id = ?', [dept.parent])
    deptInserted++
  }

  /* ---------- 3. 岗位（按 post_code 判断，部门按名字解析） ---------- */
  let postInserted = 0
  for (const post of POSTS) {
    const dept = await ds.query("SELECT id FROM sys_depart WHERE depart_name = ? AND (del_flag IS NULL OR del_flag <> '1') LIMIT 1", [post.deptName])
    const deptId = dept.length ? dept[0].id : null

    const exists = await ds.query('SELECT id FROM sys_position WHERE post_code = ?', [post.code])
    if (exists.length) {
      await ds.query('UPDATE sys_position SET post_name = ?, post_sort = ?, dept_id = ?, status = ?, update_by = ?, update_time = NOW() WHERE id = ?', [
        post.name,
        post.sort,
        deptId,
        '1',
        OPERATOR,
        exists[0].id
      ])
      continue
    }
    await ds.query('INSERT INTO sys_position (id, post_code, post_name, post_sort, dept_id, status, create_by, create_time, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), 1)', [
      `post_${post.code}`,
      post.code,
      post.name,
      post.sort,
      deptId,
      '1',
      OPERATOR
    ])
    postInserted++
  }

  /* ---------- 4. 清理冒烟残留的 smoke_ 部门（含关联关系，防孤儿行） ---------- */
  const smokeDepts = await ds.query("SELECT id FROM sys_depart WHERE depart_name LIKE 'smoke\\_%'")
  let smokeDeleted = 0
  for (const row of smokeDepts) {
    await ds.query('DELETE FROM sys_user_depart WHERE dep_id = ?', [row.id]).catch(() => undefined)
    await ds.query('DELETE FROM sys_depart WHERE id = ?', [row.id])
    smokeDeleted++
  }

  console.log(`职级：新增 ${levelInserted} 条（总经理助理补充，副总经理/总经理排序顺延）`)
  console.log(`部门：新增 ${deptInserted} 条（南山区/罗湖区研发中心）`)
  console.log(`岗位：新增 ${postInserted} 条（算法工程师/软件工程设计师/网络工程师）`)
  console.log(`清理冒烟残留部门：${smokeDeleted} 条`)

  await app.close()
})().catch(error => {
  console.error('灌数失败：', error)
  process.exit(1)
})
