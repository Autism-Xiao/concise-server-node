import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { EntityManager, Repository } from 'typeorm'

import { UserSettingEntity } from './entities/user-setting.entity'
import { MAX_SETTINGS_BYTES, normalizeSettings, settingsSize, type UserSettings } from './user-setting.util'

/** 空设置：表示「没有任何自定义项」，具体默认值由前端 `DEFAULT_SETTINGS` 提供 */
const EMPTY_SETTINGS = '{}'

/** 一份设置快照：内容 + 服务端最后修改时间（毫秒，供前端与本地副本比较新旧） */
export interface UserSettingSnapshot {
  settings: UserSettings | null
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

  /** 读取：没有记录返回 `{ settings: null, updatedAt: null }`，由前端决定用默认值 */
  async get(userId: string): Promise<UserSettingSnapshot> {
    const row = await this.repository.findOne({ where: { userId } })
    if (!row) return { settings: null, updatedAt: null }
    return {
      // 库里可能残留前端已废弃的键，读出来也过一次白名单，保证下发给前端的永远是认识的结构
      settings: normalizeSettings(this.parse(row.settings, userId)),
      updatedAt: row.updateTime ? new Date(row.updateTime).getTime() : null
    }
  }

  /**
   * 保存（合并语义）
   *
   * 传入的是 patch：与服务端已有值合并后落库，这样即使前端某次只发改动的那一项，
   * 也不会把其它键冲掉。白名单裁剪后没有可更新字段时直接返回旧值，不产生空写。
   */
  async save(userId: string, input: Record<string, unknown>): Promise<UserSettingSnapshot> {
    if (settingsSize(input) > MAX_SETTINGS_BYTES) {
      throw new BadRequestException(`设置内容过大（上限 ${MAX_SETTINGS_BYTES} 字节）`)
    }

    const patch = normalizeSettings(input)
    const current = await this.get(userId)
    if (!Object.keys(patch).length) return current

    const merged: UserSettings = { ...(current.settings ?? {}), ...patch }
    const now = new Date()
    await this.repository.upsert({ userId, settings: JSON.stringify(merged), updateTime: now }, ['userId'])
    return { settings: merged, updatedAt: now.getTime() }
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
