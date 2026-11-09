import { type MigrationInterface, type QueryRunner } from 'typeorm'

/**
 * 清洗历史设置行：剔掉「与默认值相同」的键
 *
 * 背景：`sys_user_setting` 改成「只存差异 + 读时补默认值」之前，前端保存推的是完整 `AppSettings`，
 * 后端整包落库。这些行里带着建号当时的默认值（`fontSize: 'default'` 之类），
 * 会让「后端默认值改版后老用户自动跟随」失效 —— 因为库里有值就覆盖了新默认。
 *
 * 语义等价：某键的值等于默认值，就是「没有自定义」，删掉后读时会被补回同样的值，用户无感知。
 *
 * 刻意**不动 `update_time`**：这是运维清洗，不是用户行为，改时间会让前端「本地 vs 云端谁更新」
 * 的判断出现假信号。
 *
 * 默认值在这里**内联快照**而不是 import 常量：迁移是历史记录，行为不能随后续代码改动而变。
 */
const DEFAULTS_SNAPSHOT: Record<string, string | boolean> = {
  fontSize: 'default',
  themeColor: 'default',
  customColor: '#2563eb',
  grayscale: false,
  colorWeak: false,
  sidebarVariant: 'sidebar',
  layout: 'default',
  direction: 'ltr'
}

export class StripSettingDefaults1794260000000 implements MigrationInterface {
  name = 'StripSettingDefaults1794260000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 空行占绝大多数，先挡掉，避免对全表逐行无意义地读一次
    const rows: Array<{ user_id: string; settings: string }> = await queryRunner.query(
      "SELECT `user_id`, `settings` FROM `sys_user_setting` WHERE `settings` <> '{}'"
    )

    for (const row of rows) {
      let parsed: unknown
      try {
        parsed = JSON.parse(row.settings)
      } catch {
        // 脏数据交给运行时 `parse()` 的告警逻辑处理，迁移不在这里动它
        continue
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue

      const source = parsed as Record<string, unknown>
      const kept: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(source)) {
        if (DEFAULTS_SNAPSHOT[key] !== value) kept[key] = value
      }

      // 没有可剔除的键就跳过，少一次写
      if (Object.keys(kept).length === Object.keys(source).length) continue
      await queryRunner.query('UPDATE `sys_user_setting` SET `settings` = ? WHERE `user_id` = ?', [JSON.stringify(kept), row.user_id])
    }
  }

  public async down(): Promise<void> {
    // 不恢复：被删掉的是「等于默认值」的键，补回去除了让库更胖没有任何作用
  }
}
