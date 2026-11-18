import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * sys_dict_item 增加 color 列：字典项自带语义色，前端不再硬编码业务色板
 *
 * 背景：公告优先级、任务优先级的颜色以前写死在前端的 `priorityClass` 映射里，
 * 运营想把「高」从红改橙就得改代码发版。加这一列后，颜色跟文案一样在字典里配。
 *
 * - 只存语义色（primary/success/warning/danger/info/neutral），不存 tailwind class：
 *   存 class 等于把亮色写死，暗色主题下对比度会崩，且开放任意字符串有样式注入面
 * - 允许为空：空 = 该字典项按纯文本渲染（分类类字典不需要套色块）
 * - 不回填存量数据，只为两个已有的优先级字典补上默认色，保持原有观感
 */
export class Migration1794940000000 implements MigrationInterface {
  name = 'Migration1794940000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    const colorColumn = (await queryRunner.query("SHOW COLUMNS FROM `sys_dict_item` LIKE 'color'")) as unknown[]
    if (colorColumn.length === 0) {
      await queryRunner.query(
        "ALTER TABLE `sys_dict_item` ADD COLUMN `color` varchar(16) NULL COMMENT '语义色(primary/success/warning/danger/info/neutral，空=纯文本)' AFTER `description`"
      )
    }

    // 存量优先级字典补默认色：与前端原来写死的 priorityClass 保持一致
    // 公告：H 红 / M 橙 / L 灰（值为字母）
    await queryRunner.query(
      `UPDATE \`sys_dict_item\` item
         JOIN \`sys_dict\` dict ON dict.id = item.dict_id AND dict.del_flag = 0
          SET item.color = CASE item.item_value WHEN 'H' THEN 'danger' WHEN 'M' THEN 'warning' WHEN 'L' THEN 'neutral' END
        WHERE dict.dict_code = 'sys_notice_priority'
          AND item.item_value IN ('H', 'M', 'L')
          AND item.color IS NULL`
    )
    // 任务：2 红 / 1 橙 / 0 灰（值为数字字符串）
    await queryRunner.query(
      `UPDATE \`sys_dict_item\` item
         JOIN \`sys_dict\` dict ON dict.id = item.dict_id AND dict.del_flag = 0
          SET item.color = CASE item.item_value WHEN '2' THEN 'danger' WHEN '1' THEN 'warning' WHEN '0' THEN 'neutral' END
        WHERE dict.dict_code = 'sys_task_priority'
          AND item.item_value IN ('2', '1', '0')
          AND item.color IS NULL`
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const colorColumn = (await queryRunner.query("SHOW COLUMNS FROM `sys_dict_item` LIKE 'color'")) as unknown[]
    if (colorColumn.length > 0) {
      await queryRunner.query('ALTER TABLE `sys_dict_item` DROP COLUMN `color`')
    }
  }
}
