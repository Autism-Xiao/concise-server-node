/**
 * 字典种子脚本（幂等，可重复执行）
 *
 * 目的：把前端下拉里写死的「展示型枚举」收敛成数据库字典，运营可在
 * 系统管理 → 数据字典里改文案/排序/启停，不用发版。
 *
 * 规则：
 * - 按 dict_code 找字典，存在则更新名称/描述/租户，不存在则插入（随机 32 位 id，与项目主键风格一致）
 * - 按 (dict_id, item_value) 找字典项，存在则更新文案/排序/状态，不存在则插入
 * - 统一 tenant_id = 0（平台共享：所有租户可见、可共用一套）
 * - 只做「补齐 + 更新」，不删除库里多出来的自定义项
 *
 * 注意：状态机字段（公告发布状态、任务状态、定时任务状态等）**故意不建字典**——
 * 后端按值分支，字典多出来的项就是死选项。详见 docs/2026-11-12-字典体系搭建与接入.md
 *
 * 用法：node scripts/seed-dicts.cjs [--dry]
 */
;(async () => {
  const DRY = process.argv.includes('--dry')
  const { NestFactory } = require('@nestjs/core')
  const { AppModule } = require('../dist/app.module')
  const { getDataSourceToken } = require('@nestjs/typeorm')
  const { randomBytes } = require('crypto')

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false })
  const ds = app.get(getDataSourceToken('default'))

  /**
   * items: [显示文案, 存储值, 排序]
   * 排序从 1 开始，避免和「0 未知/0 禁用」这类值混淆
   */
  const DICTS = [
    {
      code: 'sys_user_gender',
      name: '用户性别',
      desc: '用户/个人资料性别，与 sys_user.sex 对齐',
      items: [
        ['未知', '0', 1],
        ['男', '1', 2],
        ['女', '2', 3]
      ]
    },
    {
      code: 'sys_menu_status',
      name: '菜单状态',
      desc: '菜单启用/停用，与 sys_menu.status 对齐',
      items: [
        ['启用', '1', 1],
        ['停用', '0', 2]
      ]
    },
    {
      code: 'sys_notice_category',
      name: '公告类型',
      desc: '通知公告的消息类型，与 sys_announcement.msg_category 对齐',
      items: [
        ['通知公告', '1', 1],
        ['系统消息', '2', 2]
      ]
    },
    {
      code: 'sys_notice_priority',
      name: '公告优先级',
      desc: '公告展示优先级，与 sys_announcement.priority（L/M/H）对齐',
      items: [
        ['高', 'H', 1],
        ['中', 'M', 2],
        ['低', 'L', 3]
      ]
    },
    {
      code: 'sys_notice_target',
      name: '通告对象',
      desc: '公告接收范围，与 sys_announcement.msg_type（ALL/USER）对齐',
      items: [
        ['全体用户', 'ALL', 1],
        ['指定用户', 'USER', 2]
      ]
    },
    {
      code: 'sys_task_priority',
      name: '任务优先级',
      desc: '任务优先级，与 sys_task.priority（0/1/2）对齐',
      items: [
        ['低', '0', 1],
        ['中', '1', 2],
        ['高', '2', 3]
      ]
    },
    {
      code: 'sys_org_category',
      name: '机构类型',
      desc: '部门管理里的机构类别，与 sys_depart.org_category 对齐',
      items: [
        ['公司', '1', 1],
        ['部门', '2', 2],
        ['岗位', '3', 3],
        ['子公司', '4', 4]
      ]
    },
    {
      code: 'sys_tenant_plan',
      name: '租户套餐',
      desc: '租户套餐版本，与 sys_tenant.plan 对齐',
      items: [
        ['试用版', '试用版', 1],
        ['标准版', '标准版', 2],
        ['企业版', '企业版', 3]
      ]
    }
  ]

  const newId = () => randomBytes(16).toString('hex')
  const log = (...args) => console.log(DRY ? '[dry]' : '[seed]', ...args)

  let created = 0
  let updated = 0
  let itemsCreated = 0
  let itemsUpdated = 0

  for (const dict of DICTS) {
    const [exist] = await ds.query('SELECT id FROM sys_dict WHERE dict_code = ? AND del_flag = 0 LIMIT 1', [dict.code])
    let dictId = exist?.id
    if (dictId) {
      log(`更新字典 ${dict.code}（${dict.items.length} 项）`)
      if (!DRY) {
        await ds.query('UPDATE sys_dict SET dict_name = ?, description = ?, tenant_id = 0 WHERE id = ?', [
          dict.name,
          dict.desc,
          dictId
        ])
      }
      updated++
    } else {
      dictId = newId()
      log(`新建字典 ${dict.code}（${dict.items.length} 项）`)
      if (!DRY) {
        await ds.query(
          `INSERT INTO sys_dict (id, dict_name, dict_code, description, del_flag, type, create_by, create_time, tenant_id)
           VALUES (?, ?, ?, ?, 0, 0, 'seed-dicts', NOW(), 0)`,
          [dictId, dict.name, dict.code, dict.desc]
        )
      }
      created++
    }

    for (const [text, value, sort] of dict.items) {
      const [item] = await ds.query('SELECT id FROM sys_dict_item WHERE dict_id = ? AND item_value = ? LIMIT 1', [
        dictId,
        value
      ])
      if (item?.id) {
        if (!DRY) {
          await ds.query('UPDATE sys_dict_item SET item_text = ?, sort_order = ?, status = 1, tenant_id = 0 WHERE id = ?', [
            text,
            sort,
            item.id
          ])
        }
        itemsUpdated++
      } else {
        if (!DRY) {
          await ds.query(
            `INSERT INTO sys_dict_item (id, dict_id, item_text, item_value, description, sort_order, status, create_by, create_time, tenant_id)
             VALUES (?, ?, ?, ?, NULL, ?, 1, 'seed-dicts', NOW(), 0)`,
            [newId(), dictId, text, value, sort]
          )
        }
        itemsCreated++
      }
    }
  }

  // 既有字典项也归一到平台共享，否则切到其他租户看不到
  if (!DRY) {
    await ds.query('UPDATE sys_dict_item SET tenant_id = 0 WHERE tenant_id <> 0')
  }

  console.log(
    `完成：字典 ${created} 新建 / ${updated} 更新；字典项 ${itemsCreated} 新建 / ${itemsUpdated} 更新${DRY ? '（dry-run，未写库）' : ''}`
  )
  await app.close()
})().catch(e => {
  console.error('种子失败：', e.message)
  process.exit(1)
})
