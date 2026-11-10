/**
 * 多租户演示数据脚本（幂等，可重复执行）
 *
 * 目的：让「多租户隔离」在界面上真的看得出差别 —— 光有两个空租户切换起来毫无体感。
 *
 * 做四件事：
 * 1. 清理：物理删除纯联调残留的租户（无用户、无业务数据）、清 smoke 前缀部门、软删自动化测试账号
 * 2. 建两个演示租户：深圳示范科技（demo_sz）、长沙示范科技（demo_cs）
 * 3. 每个租户造一套「名字完全不一样」的数据：部门树 / 岗位 / 职级 / 公告 / 任务
 * 4. 在 tenant_id = 0 造一条平台共享公告，用来验证「共享数据所有租户可见」
 *
 * 另外把 zhangsan 分配进深圳、ceshi 分配进长沙（都保留默认租户），
 * 这样用普通账号登录也能验证「只能切自己所属的租户」。
 *
 * 注意几个全局唯一索引（不是租户内唯一，造数据必须错开）：
 *   sys_depart.org_code / sys_position.post_code / sys_level.level_name / sys_tenant.code
 * 所以深圳用 B0x 编码段、长沙用 C0x，岗位/职级名称也带城市前缀。
 *
 * 用法：npm run build; node scripts/seed-tenant-demo.cjs
 */
;(async () => {
  const { NestFactory } = require('@nestjs/core')
  const { AppModule } = require('../dist/app.module')
  const { getDataSourceToken } = require('@nestjs/typeorm')

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false })
  const ds = app.get(getDataSourceToken('default'))
  const OPERATOR = 'seed'

  /** 租户 + 该租户下的全部演示数据（名字刻意不重复，切换时一眼能分辨） */
  const TENANTS = [
    {
      code: 'demo_sz',
      name: '深圳示范科技有限公司',
      plan: 'enterprise',
      beginDate: '2026-01-01',
      expireAt: '2027-12-31',
      contact: '李明',
      phone: '0755-8888 0001',
      remark: '演示租户：华南区总部，编制完整（企业版）',
      users: ['zhangsan'],
      depts: [
        { id: 'sz_dept_root', name: '深圳示范科技', parent: null, code: 'B01', cat: '1', order: 1 },
        { id: 'sz_dept_ai', name: 'AI 研发中心', parent: 'sz_dept_root', code: 'B01B01', cat: '2', order: 1 },
        { id: 'sz_dept_hw', name: '智能硬件事业部', parent: 'sz_dept_root', code: 'B01B02', cat: '2', order: 2 },
        { id: 'sz_dept_sales', name: '华南销售部', parent: 'sz_dept_root', code: 'B01B03', cat: '2', order: 3 },
        { id: 'sz_dept_sub', name: '东莞智造子公司', parent: 'sz_dept_root', code: 'B01B04', cat: '4', order: 4 }
      ],
      posts: [
        { code: 'sz_pm', name: '产品经理', dept: 'sz_dept_ai', sort: 1 },
        { code: 'sz_algo', name: '算法专家', dept: 'sz_dept_ai', sort: 2 },
        { code: 'sz_sales', name: '大客户销售', dept: 'sz_dept_sales', sort: 3 }
      ],
      levels: [
        { name: '深圳-工程师', rank: 1 },
        { name: '深圳-高级工程师', rank: 2 },
        { name: '深圳-技术总监', rank: 3 }
      ],
      notices: [
        { id: 'sz_notice_001', title: '【深圳】Q4 全员会通知', content: '定于 12 月 20 日在南山总部 3 楼多功能厅召开 Q4 全员会，请各部门提前准备季度汇报材料。' },
        { id: 'sz_notice_002', title: '【深圳】AI 研发中心工位调整', content: 'AI 研发中心下周整体迁至 8 楼东区，请于本周五前完成个人物品打包。' }
      ],
      tasks: [
        { title: '完成智能硬件样机 V2 验收', desc: '对照验收清单逐项确认，输出验收报告。', priority: 2, status: 1 },
        { title: '整理华南区重点客户名单', desc: '按行业与合同额排序，标注续约时间。', priority: 1, status: 0 }
      ]
    },
    {
      code: 'demo_cs',
      name: '长沙示范科技有限公司',
      plan: 'standard',
      beginDate: '2026-03-01',
      expireAt: '2026-12-31',
      contact: '王芳',
      phone: '0731-6666 0002',
      remark: '演示租户：华中交付中心（标准版，年底到期）',
      users: ['ceshi'],
      depts: [
        { id: 'cs_dept_root', name: '长沙示范科技', parent: null, code: 'C01', cat: '1', order: 1 },
        { id: 'cs_dept_delivery', name: '华中交付中心', parent: 'cs_dept_root', code: 'C01C01', cat: '2', order: 1 },
        { id: 'cs_dept_service', name: '客户成功部', parent: 'cs_dept_root', code: 'C01C02', cat: '2', order: 2 },
        { id: 'cs_dept_ops', name: '运维保障组', parent: 'cs_dept_delivery', code: 'C01C01C01', cat: '2', order: 1 }
      ],
      posts: [
        { code: 'cs_delivery', name: '交付实施工程师', dept: 'cs_dept_delivery', sort: 1 },
        { code: 'cs_success', name: '客户成功经理', dept: 'cs_dept_service', sort: 2 }
      ],
      levels: [
        { name: '长沙-专员', rank: 1 },
        { name: '长沙-主管', rank: 2 }
      ],
      notices: [
        { id: 'cs_notice_001', title: '【长沙】交付季排班调整', content: '12 月为交付高峰，运维保障组自 12 月 1 日起执行双人值守，排班表见附件。' }
      ],
      tasks: [
        { title: '华中三个客户上线验收', desc: '逐家确认上线清单与培训完成率。', priority: 3, status: 1 }
      ]
    }
  ]

  /** 平台共享数据：tenant_id = 0，所有租户都应该看得到 */
  const SHARED_NOTICE = {
    id: 'shared_notice_001',
    title: '【平台】系统维护公告（所有租户可见）',
    content: '平台将于每周日 02:00-04:00 进行例行维护，期间服务可能短暂不可用。'
  }


  /* ---------- 1. 清理：联调残留租户（无用户无业务数据才物理删） ---------- */
  const staleTenants = await ds.query("SELECT id, name, code FROM sys_tenant WHERE code LIKE 'fe\\_probe%' OR code LIKE 'probe\\_%' OR code LIKE 'smoke\\_%'")
  let tenantPurged = 0
  for (const tenant of staleTenants) {
    const [{ n: userCount }] = await ds.query('SELECT COUNT(*) AS n FROM sys_user_tenant WHERE tenant_id = ?', [tenant.id])
    if (Number(userCount) > 0) {
      console.warn(`保留租户「${tenant.name}」(id=${tenant.id})：名下还有 ${userCount} 个用户，不能直接删`)
      continue
    }
    const businessTables = ['sys_depart', 'sys_role', 'sys_position', 'sys_level', 'sys_announcement', 'task', 'sys_dict', 'sys_file']
    let used = 0
    for (const table of businessTables) {
      const [{ n }] = await ds.query(`SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id = ?`, [tenant.id])
      used += Number(n)
    }
    if (used > 0) {
      console.warn(`保留租户「${tenant.name}」(id=${tenant.id})：名下还有 ${used} 条业务数据，改为软删`)
      await ds.query('UPDATE sys_tenant SET del_flag = 1 WHERE id = ?', [tenant.id])
      continue
    }
    await ds.query('DELETE FROM sys_tenant WHERE id = ?', [tenant.id])
    tenantPurged++
    console.log(`已删除联调残留租户「${tenant.name}」(code=${tenant.code})`)
  }

  /* ---------- 2. 清理：smoke 部门的物理残留（含关联表，防孤儿行） ---------- */
  // 不用 'smoke\_%'：残留里既有 smoke部门A（中文紧跟）也有 smoke_ 前缀，统一按前缀匹配更稳
  const smokeDepts = await ds.query("SELECT id, depart_name FROM sys_depart WHERE depart_name LIKE 'smoke%'")
  for (const row of smokeDepts) {
    await ds.query('DELETE FROM sys_user_depart WHERE dep_id = ?', [row.id]).catch(() => undefined)
    await ds.query('DELETE FROM sys_role_depart WHERE dep_id = ?', [row.id]).catch(() => undefined)
    await ds.query('DELETE FROM sys_depart WHERE id = ?', [row.id])
  }
  if (smokeDepts.length) console.log(`已清理 smoke 部门 ${smokeDepts.length} 条`)

  /* ---------- 3. 清理：自动化测试账号（软删，可回滚） ---------- */
  const testUsers = await ds.query("SELECT id, username FROM sys_user WHERE del_flag = 0 AND (username LIKE 'smoke\\_%' OR username LIKE 'um\\_%')")
  for (const user of testUsers) {
    await ds.query("UPDATE sys_user SET del_flag = 1, update_time = NOW() WHERE id = ?", [user.id])
  }
  if (testUsers.length) console.log(`已软删自动化测试账号 ${testUsers.length} 个（del_flag=1，可回滚）`)

  /* ---------- 4. 逐租户：建租户 + 基础数据 ---------- */
  const summary = []

  for (const tenant of TENANTS) {
    // 4.1 租户（按 code 幂等；已存在则刷新名称/套餐/到期，并确保未删）
    const found = await ds.query('SELECT id FROM sys_tenant WHERE code = ?', [tenant.code])
    let tenantId
    if (found.length) {
      tenantId = found[0].id
      await ds.query(
        "UPDATE sys_tenant SET name = ?, plan = ?, contact = ?, phone = ?, begin_date = ?, expire_at = ?, remark = ?, status = 0, del_flag = 0, update_by = ?, update_time = NOW() WHERE id = ?",
        [tenant.name, tenant.plan, tenant.contact, tenant.phone, tenant.beginDate, tenant.expireAt, tenant.remark, OPERATOR, tenantId]
      )
    } else {
      const result = await ds.query(
        `INSERT INTO sys_tenant (name, code, contact, phone, plan, begin_date, expire_at, status, remark, del_flag, create_by, create_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, NOW())`,
        [tenant.name, tenant.code, tenant.contact, tenant.phone, tenant.plan, tenant.beginDate, tenant.expireAt, tenant.remark, OPERATOR]
      )
      tenantId = result.insertId
    }

    // 4.2 部门树（先父后子，父级可能就在本批里）
    let deptInserted = 0
    for (const dept of tenant.depts) {
      const exists = await ds.query('SELECT id FROM sys_depart WHERE id = ?', [dept.id])
      if (exists.length) {
        await ds.query(
          "UPDATE sys_depart SET parent_id = ?, depart_name = ?, org_code = ?, org_category = ?, depart_order = ?, status = '1', del_flag = '0', tenant_id = ?, update_by = ?, update_time = NOW() WHERE id = ?",
          [dept.parent, dept.name, dept.code, dept.cat, dept.order, tenantId, OPERATOR, dept.id]
        )
        continue
      }
      await ds.query(
        `INSERT INTO sys_depart (id, parent_id, depart_name, org_code, org_category, depart_order, status, del_flag, create_by, create_time, tenant_id, iz_leaf)
         VALUES (?, ?, ?, ?, ?, ?, '1', '0', ?, NOW(), ?, 1)`,
        [dept.id, dept.parent, dept.name, dept.code, dept.cat, dept.order, OPERATOR, tenantId]
      )
      if (dept.parent) await ds.query('UPDATE sys_depart SET iz_leaf = 0 WHERE id = ?', [dept.parent])
      deptInserted++
    }

    // 4.3 岗位（post_code 全局唯一，所以带城市前缀）
    let postInserted = 0
    for (const post of tenant.posts) {
      const exists = await ds.query('SELECT id FROM sys_position WHERE post_code = ?', [post.code])
      if (exists.length) {
        await ds.query("UPDATE sys_position SET post_name = ?, dept_id = ?, post_sort = ?, status = '1', tenant_id = ?, update_by = ?, update_time = NOW() WHERE id = ?", [
          post.name,
          post.dept,
          post.sort,
          tenantId,
          OPERATOR,
          exists[0].id
        ])
        continue
      }
      await ds.query(
        `INSERT INTO sys_position (id, post_code, post_name, post_sort, dept_id, status, description, create_by, create_time, tenant_id)
         VALUES (?, ?, ?, ?, ?, '1', ?, ?, NOW(), ?)`,
        [`pos_${post.code}`, post.code, post.name, post.sort, post.dept, `${tenant.name} 演示岗位`, OPERATOR, tenantId]
      )
      postInserted++
    }

    // 4.4 职级（level_name 全局唯一，同样带城市前缀）
    let levelInserted = 0
    for (const level of tenant.levels) {
      const exists = await ds.query('SELECT id FROM sys_level WHERE level_name = ?', [level.name])
      if (exists.length) {
        await ds.query("UPDATE sys_level SET level_rank = ?, status = '1', tenant_id = ?, update_by = ?, update_time = NOW() WHERE id = ?", [
          level.rank,
          tenantId,
          OPERATOR,
          exists[0].id
        ])
        continue
      }
      await ds.query(
        `INSERT INTO sys_level (id, level_name, level_rank, status, remark, create_by, create_time, tenant_id)
         VALUES (?, ?, ?, '1', ?, ?, NOW(), ?)`,
        [`lvl_${tenant.code}_${level.rank}`, level.name, level.rank, `${tenant.name} 演示职级`, OPERATOR, tenantId]
      )
      levelInserted++
    }

    // 4.5 公告（send_status='1' 已发布；'0' 未发布 / '2' 已撤销，填错前端公告栏看不到）
    let noticeInserted = 0
    for (const notice of tenant.notices) {
      const exists = await ds.query('SELECT id FROM sys_announcement WHERE id = ?', [notice.id])
      if (exists.length) {
        await ds.query(
          "UPDATE sys_announcement SET titile = ?, msg_content = ?, tenant_id = ?, send_status = '1', send_time = NOW(), del_flag = '0' WHERE id = ?",
          [notice.title, notice.content, tenantId, notice.id]
        )
        continue
      }
      await ds.query(
        `INSERT INTO sys_announcement (id, tenant_id, titile, msg_content, msg_category, msg_type, priority, send_status, sender, send_time, del_flag, create_by, create_time)
         VALUES (?, ?, ?, ?, '1', 'ALL', 'M', '1', ?, NOW(), '0', ?, NOW())`,
        [notice.id, tenantId, notice.title, notice.content, OPERATOR, OPERATOR]
      )
      noticeInserted++
    }

    // 4.6 任务（按 tenant_id + title 幂等）
    let taskInserted = 0
    for (const task of tenant.tasks) {
      const exists = await ds.query('SELECT id FROM task WHERE tenant_id = ? AND title = ?', [tenantId, task.title])
      if (exists.length) continue
      await ds.query('INSERT INTO task (tenant_id, title, description, priority, status) VALUES (?, ?, ?, ?, ?)', [
        tenantId,
        task.title,
        task.desc,
        task.priority,
        task.status
      ])
      taskInserted++
    }

    // 4.7 把演示账号挂进该租户（保留其原有租户，不动默认租户归属）
    for (const username of tenant.users) {
      const users = await ds.query('SELECT id FROM sys_user WHERE username = ? AND del_flag = 0', [username])
      if (!users.length) {
        console.warn(`跳过用户 ${username}：账号不存在或已删除`)
        continue
      }
      const userId = users[0].id
      const linked = await ds.query('SELECT id FROM sys_user_tenant WHERE user_id = ? AND tenant_id = ?', [userId, tenantId])
      if (!linked.length) {
        await ds.query('INSERT INTO sys_user_tenant (user_id, tenant_id, status, create_time) VALUES (?, ?, 0, NOW())', [userId, tenantId])
      }
    }

    summary.push({
      tenantId,
      name: tenant.name,
      code: tenant.code,
      users: tenant.users.join('、') || '-',
      depts: tenant.depts.length,
      posts: tenant.posts.length,
      levels: tenant.levels.length,
      notices: tenant.notices.length,
      tasks: tenant.tasks.length,
      inserted: { deptInserted, postInserted, levelInserted, noticeInserted, taskInserted }
    })
  }

  /* ---------- 5. 平台共享公告（tenant_id = 0） ---------- */
  // 用 upsert 而不是「不存在才插」：状态枚举改过一版（'2' 是已撤销，'1' 才是已发布），
  // 只插不改会让历史错误值永远留在库里。
  await ds.query(
    `INSERT INTO sys_announcement (id, tenant_id, titile, msg_content, msg_category, msg_type, priority, send_status, sender, send_time, del_flag, create_by, create_time)
     VALUES (?, 0, ?, ?, '1', 'ALL', 'H', '1', ?, NOW(), '0', ?, NOW())
     ON DUPLICATE KEY UPDATE titile = VALUES(titile), msg_content = VALUES(msg_content), tenant_id = 0,
       send_status = '1', send_time = NOW(), del_flag = '0'`,
    [SHARED_NOTICE.id, SHARED_NOTICE.title, SHARED_NOTICE.content, OPERATOR, OPERATOR]
  )

  /* ---------- 6. 结果 ---------- */
  console.log('\n=== 演示租户 ===')
  for (const item of summary) {
    console.log(`#${item.tenantId} ${item.name}（${item.code}）  演示账号：${item.users}`)
    console.log(`   部门 ${item.depts} / 岗位 ${item.posts} / 职级 ${item.levels} / 公告 ${item.notices} / 任务 ${item.tasks}`)
    console.log(`   本次新增：部门 ${item.inserted.deptInserted}、岗位 ${item.inserted.postInserted}、职级 ${item.inserted.levelInserted}、公告 ${item.inserted.noticeInserted}、任务 ${item.inserted.taskInserted}`)
  }
  console.log(`\n清理：联调残留租户 ${tenantPurged} 个、smoke 部门 ${smokeDepts.length} 条、测试账号 ${testUsers.length} 个（软删）`)
  console.log('平台共享公告：1 条（tenant_id=0，所有租户都应可见）')
  console.log('\n验证方式：admin 登录后顶栏切换租户，对比「部门管理 / 公告 / 任务」列表\n')

  await app.close()
})().catch(error => {
  console.error('灌数失败：', error)
  process.exit(1)
})
