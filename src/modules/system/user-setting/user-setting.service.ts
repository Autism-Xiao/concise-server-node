import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { EntityManager, Repository } from 'typeorm'

import { UserSettingEntity } from './entities/user-setting.entity'
import { MAX_SETTINGS_BYTES, normalizeSettings, settingsSize, stripDefaultSettings, withDefaults, type UserSettings } from './user-setting.util'

/** 空设置：表示「没有任何自定义项」，具体默认值由 `DEFAULT_USER_SETTINGS` 补齐 */
const EMPTY_SETTINGS = '{}'

/**
 * 一份设置快照
 *
 * `settings` 恒为**完整可用**对象（已用默认值补齐），前端可以直接渲染，不需要自己 merge；
 * `updatedAt` 为 `null` 表示这个账号从没改过设置（库里是空行），供前端判断「有无自定义」。
 */
export interface UserSettingSnapshot {
  settings: UserSettings
  updatedAt: number | null
}

@Injectable()
export class UserSettingService {
  private readonly logger = new Logger(UserSettingService.name)

  constructor(
    @InjectRepository(UserSettingEntity)
    private readonly repository: Repository<UserSettingEntity>
  ) {}

  /**
   * 建号即建行（幂等）
   *
   * 用户一创建就落一行空设置，而不是等前端第一次点「保存」才 upsert：
   * ① 后台「用户管理」能直接看到这个账号有没有自定义过偏好，不用登录一遍；
   * ② 避免「用户存在但设置行不存在」这种半成品状态被复制、导出、比对时当成脏数据。
   *
   * 存 `'{}'` 而不是前端那份完整默认值：默认值将来会改（加设置项、换默认主题），
   * 一旦固化成具体值，老用户就永远停在建号那天的默认。
   * `update_time` 留 NULL 表示「从未修改过」，前端据此判新旧时不会压掉本机改动。
   */
  async ensure(userId: string, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(UserSettingEntity) : this.repository
    // INSERT IGNORE：重复调用（并发建号 / 恢复账号）静默跳过，不做「先查后插」
    await repo.createQueryBuilder().insert().values({ userId, settings: EMPTY_SETTINGS, updateTime: null }).orIgnore().execute()
  }

  /**
   * 读取：**始终返回完整对象**
   *
   * 库里只存用户改过的键（差异），这里用服务端默认值补齐后再下发，
   * 于是前端不需要自己维护一份默认值做 merge，新增设置项时老用户也自动跟上。
   * 没有记录（老账号 / 直接 SQL 插的用户）同样返回默认值，`updatedAt` 为 null 表示「从未修改过」。
   */
  async get(userId: string): Promise<UserSettingSnapshot> {
    const row = await this.repository.findOne({ where: { userId } })
    if (!row) return { settings: withDefaults(null), updatedAt: null }
    return {
      settings: withDefaults(this.normalizeRow(row, userId)),
      updatedAt: row.updateTime ? new Date(row.updateTime).getTime() : null
    }
  }

  /**
   * 保存（合并语义）
   *
   * 传入的是 patch：与**库里已存的差异**合并后落库，这样即使前端某次只发改动的那一项，
   * 也不会把其它键冲掉。两个必须做的细节：
   *  ① 合并基准用 `readStored()`（原始差异）而不是 `get()`（补齐后）——后者会把默认值带进来；
   *  ② 合并后过一遍 `stripDefaultSettings()`——前端推的是完整 8 项，不剔除等于整包固化默认值，
   *    将来默认值改版这些人就不跟随了。
   * 白名单裁剪后没有可更新字段时直接返回当前快照，不产生空写。
   */
  async save(userId: string, input: Record<string, unknown>): Promise<UserSettingSnapshot> {
    if (settingsSize(input) > MAX_SETTINGS_BYTES) {
      throw new BadRequestException(`设置内容过大（上限 ${MAX_SETTINGS_BYTES} 字节）`)
    }

    const patch = normalizeSettings(input)
    if (!Object.keys(patch).length) return this.get(userId)

    const stored = await this.readStored(userId)
    // 先合并再剔除与默认值相同的键：前端推的是完整 8 项，不剔除等于整包固化默认值
    const merged = stripDefaultSettings({ ...(stored ?? {}), ...patch })
    const now = new Date()
    await this.repository.upsert({ userId, settings: JSON.stringify(merged), updateTime: now }, ['userId'])
    // 返回给前端的是补齐后的完整对象，与 GET 口径一致
    return { settings: withDefaults(merged), updatedAt: now.getTime() }
  }

  /** 库里已存的**差异**（不补默认值）：save 的合并基准，也是「只存差异」的保证 */
  private async readStored(userId: string): Promise<UserSettings | null> {
    const row = await this.repository.findOne({ where: { userId } })
    return row ? this.normalizeRow(row, userId) : null
  }

  /** 行 → 白名单内的差异对象（库里可能残留前端已废弃的键，读出来也过一次白名单） */
  private normalizeRow(row: UserSettingEntity, userId: string): UserSettings {
    return normalizeSettings(this.parse(row.settings, userId))
  }

  /** 解析 JSON：脏数据只记日志不抛 500，避免一条坏记录把设置接口打死 */
  private parse(raw: string, userId: string): Record<string, unknown> | null {
    try {
      return JSON.parse(raw) as Record<string, unknown>
    } catch {
      this.logger.warn(`用户 ${userId} 的设置 JSON 解析失败，按空设置处理`)
      return null
    }
  }
}
