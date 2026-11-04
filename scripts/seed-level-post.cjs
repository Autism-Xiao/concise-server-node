/**
 * 职级 / 岗位示例数据脚本（幂等，可重复执行）
 *
 * 数据来源：
 * - sys_level  → JeecgBoot 官方「职务职级」字典 position_rank（sys_dict_item：
 *                员工=1 / 小组长=2 / 部门经理=3 / 副总经理=4），总经理为组织架构最高职务补齐
 * - sys_position → 与上述职级一一对应的职务岗，挂在 sys_depart 实际部门下
 *
 * 说明：
 * - 本表 level_rank 语义是「数字越大级别越高」，与 jeecg position_rank 的序号同向，直接沿用其数值
 * - 幂等策略：按业务唯一键（level_name / post_code）判断，存在则更新、缺失则插入
 * - 部门取自库内真实 sys_depart（dept_1 总公司 / dept_2 研发部），部门不存在时该岗位 dept_id 置空
 *
 * 用法：node scripts/seed-level-post.cjs
 */
;(async () => {
  const { NestFactory } = require('@nestjs/core')
  const { AppModule } = require('../dist/app.module')
  const { getDataSourceToken } = require('@nestjs/typeorm')

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false })
  const ds = app.get(getDataSourceToken('default'))

  /** 职级：jeecg position_rank 字典项（数字越大级别越高） */
  const LEVELS = [
    { name: '员工', rank: 1, remark: 'JeecgBoot position_rank=1，基础执行岗' },
    { name: '小组长', rank: 2, remark: 'JeecgBoot position_rank=2，带领小组完成既定任务' },
    { name: '部门经理', rank: 3, remark: 'JeecgBoot position_rank=3，部门负责人' },
    { name: '副总经理', rank: 4, remark: 'JeecgBoot position_rank=4，分管业务条线' },
    { name: '总经理', rank: 5, remark: 'JeecgBoot 组织架构最高职务，全面负责经营管理' }
  ]

  /** 岗位：与职级一一对应的职务岗 */
  const POSTS = [
    { code: 'general_manager', name: '总经理', sort: 1, dept: 'dept_1', desc: '全面负责公司经营管理，向董事会汇报' },
    { code: 'deputy_general_manager', name: '副总经理', sort: 2, dept: 'dept_1', desc: '分管研发/测试等业务条线，向总经理汇报' },
    { code: 'dept_manager', name: '部门经理', sort: 3, dept: 'dept_1', desc: '负责本部门目标达成与团队管理，向分管副总汇报' },
    { code: 'team_leader', name: '小组长', sort: 4, dept: 'dept_2', desc: '带领小组完成研发任务，向部门经理汇报' },
    { code: 'staff', name: '员工', sort: 5, dept: 'dept_2', desc: '承担具体研发/测试执行工作' }
  ]

  const OPERATOR = 'seed'
  let levelInserted = 0
  let levelUpdated = 0

  for (const level of LEVELS) {
    const exists = await ds.query('SELECT id FROM sys_level WHERE level_name = ?', [level.name])
    if (exists.length) {
      await ds.query('UPDATE sys_level SET level_rank = ?, status = ?, remark = ?, update_by = ?, update_time = NOW() WHERE id = ?', [
        level.rank,
        '1',
        level.remark,
        OPERATOR,
        exists[0].id
      ])
      levelUpdated++
    } else {
      await ds.query(
        'INSERT INTO sys_level (id, level_name, level_rank, status, remark, create_by, create_time, tenant_id) VALUES (?, ?, ?, ?, ?, ?, NOW(), 0)',
        [`lvl_${level.code ?? level.rank}`, level.name, level.rank, '1', level.remark, OPERATOR]
      )
      levelInserted++
    }
  }

  let postInserted = 0
  let postUpdated = 0

  for (const post of POSTS) {
    // 部门必须真实存在，否则置空（岗位表 dept_id 允许为空）
    const dept = await ds.query('SELECT id FROM sys_depart WHERE id = ? AND del_flag = ?', [post.dept, '0'])
    const deptId = dept.length ? post.dept : null

    const exists = await ds.query('SELECT id FROM sys_position WHERE post_code = ?', [post.code])
    if (exists.length) {
      await ds.query('UPDATE sys_position SET post_name = ?, post_sort = ?, dept_id = ?, status = ?, description = ?, update_by = ?, update_time = NOW() WHERE id = ?', [
        post.name,
        post.sort,
        deptId,
        '1',
        post.desc,
        OPERATOR,
        exists[0].id
      ])
      postUpdated++
    } else {
      await ds.query(
        'INSERT INTO sys_position (id, post_code, post_name, post_sort, dept_id, status, description, create_by, create_time, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), 0)',
        [`post_${post.code}`, post.code, post.name, post.sort, deptId, '1', post.desc, OPERATOR]
      )
      postInserted++
    }
  }

  console.log(`职级：新增 ${levelInserted} 条，更新 ${levelUpdated} 条`)
  console.log(`岗位：新增 ${postInserted} 条，更新 ${postUpdated} 条`)

  await app.close()
})().catch(error => {
  console.error('灌数失败：', error)
  process.exit(1)
})
