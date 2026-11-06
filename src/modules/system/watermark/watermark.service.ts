import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'

import { BizErrorCode } from '../../../common/enums/biz-error-code.enum'
import { BizException } from '../../../common/exceptions/biz.exception'
import { normalizeWatermarkContent, renderWatermarkLines } from '../../../utils/watermark-template.util'
import { UpdateMyWatermarkDto } from './dto/update-my-watermark.dto'
import { UpdateUserWatermarkDto } from './dto/update-user-watermark.dto'
import { UpdateWatermarkSettingDto } from './dto/update-watermark-setting.dto'
import { UserWatermarkEntity } from './entities/user-watermark.entity'
import { WatermarkSettingEntity } from './entities/watermark-setting.entity'
import {
  FALLBACK_WATERMARK_SETTING,
  resolveWatermarkState,
  type WatermarkDensity,
  type WatermarkMode,
  type WatermarkSettingSnapshot,
  type WatermarkUserSnapshot
} from './watermark.util'

/** 全局配置单行主键 */
const SETTING_ID = 1

/** resolve 只依赖这几个用户字段，不直接依赖 UserEntity，避免模块间循环引用 */
export interface WatermarkUserLike {
  id: string
  username?: string | null
  realname?: string | null
  depts?: { departName?: string | null }[] | null
}

/** 下发给前端的生效水印配置（lines 已是最终文本，前端只负责画） */
export interface ResolvedWatermark {
  enabled: boolean
  lines: string[]
  density: string
  opacity: number
  rotate: number
  fontSize: number
  mode: WatermarkMode
  enforced: number
  editable: boolean
  reason: string | null
  custom: {
    enabled: number | null
    content: string | null
    density: string | null
  }
}

/**
 * 页面水印服务
 *
 * 配置来源只有两处：sys_watermark_setting（全局，admin 维护）与 sys_user_watermark（用户覆盖）。
 * 生效规则统一走 resolveWatermarkState，接口、前端、用户列表都用同一份判定。
 */
@Injectable()
export class WatermarkService {
  constructor(
    @InjectRepository(WatermarkSettingEntity) private readonly settingRepository: Repository<WatermarkSettingEntity>,
    @InjectRepository(UserWatermarkEntity) private readonly userRepository: Repository<UserWatermarkEntity>
  ) {}

  /** 全局策略（无配置行时用兜底值，保证接口不因缺数据而 500） */
  async getSetting(): Promise<WatermarkSettingSnapshot> {
    const row = await this.settingRepository.findOne({ where: { id: SETTING_ID } })
    return row ? this.toSettingSnapshot(row) : { ...FALLBACK_WATERMARK_SETTING }
  }

  /** 解析某个用户最终的生效水印（前端进入后台时调用的就是这条链路） */
  async resolve(user: WatermarkUserLike, ip?: string | null): Promise<ResolvedWatermark> {
    const [setting, custom] = await Promise.all([this.getSetting(), this.userRepository.findOne({ where: { userId: user.id } })])
    const state = resolveWatermarkState(setting, custom)

    return {
      enabled: state.enabled,
      lines: renderWatermarkLines(custom?.content ?? setting.content, {
        username: user.username,
        nickname: user.realname,
        dept: user.depts?.[0]?.departName,
        ip,
        userId: user.id
      }),
      density: custom?.density ?? setting.density,
      opacity: setting.opacity,
      rotate: setting.rotate,
      fontSize: setting.fontSize,
      mode: state.mode,
      enforced: state.enforced,
      editable: state.editable,
      reason: state.reason,
      custom: {
        enabled: custom?.enabled ?? null,
        content: custom?.content ?? null,
        density: custom?.density ?? null
      }
    }
  }

  /** 用户改自己的水印：被管理员锁定时直接拒绝，而不是静默忽略 */
  async updateMine(user: WatermarkUserLike, dto: UpdateMyWatermarkDto, ip?: string | null): Promise<ResolvedWatermark> {
    const state = await this.resolve(user, ip)
    if (!state.editable) {
      throw new BizException(BizErrorCode.BUSINESS_ERROR, state.reason ?? '当前账号的水印由管理员锁定，无法修改')
    }

    const entity = (await this.userRepository.findOne({ where: { userId: user.id } })) ?? this.userRepository.create({ userId: user.id, enforced: 0 })
    if (dto.enabled !== undefined) {
      entity.enabled = dto.enabled === null ? null : dto.enabled ? 1 : 0
    }
    if (dto.content !== undefined) {
      entity.content = normalizeWatermarkContent(dto.content) || null
    }
    if (dto.density !== undefined) {
      entity.density = dto.density ?? null
    }
    entity.updatedBy = user.username ?? null
    entity.updatedAt = new Date()
    await this.userRepository.save(entity)

    return this.resolve(user, ip)
  }

  /** 管理员给指定用户设置水印（含 enforced 强管控档） */
  async updateForUser(userId: string, dto: UpdateUserWatermarkDto, operator?: string | null): Promise<WatermarkUserSnapshot> {
    const entity = (await this.userRepository.findOne({ where: { userId } })) ?? this.userRepository.create({ userId, enforced: 0 })
    if (dto.enabled !== undefined) {
      entity.enabled = dto.enabled === null ? null : dto.enabled ? 1 : 0
    }
    if (dto.enforced !== undefined) {
      entity.enforced = dto.enforced
    }
    if (dto.content !== undefined) {
      entity.content = normalizeWatermarkContent(dto.content) || null
    }
    if (dto.density !== undefined) {
      entity.density = dto.density ?? null
    }
    entity.updatedBy = operator ?? null
    entity.updatedAt = new Date()
    await this.userRepository.save(entity)

    return { enabled: entity.enabled ?? null, enforced: entity.enforced, content: entity.content ?? null, density: entity.density ?? null }
  }

  /** 管理员修改全局策略；enabled 与 mode 联动，避免出现「开着但全站关闭」的自相矛盾状态 */
  async updateSetting(dto: UpdateWatermarkSettingDto, operator?: string | null): Promise<WatermarkSettingSnapshot> {
    const current = await this.settingRepository.findOne({ where: { id: SETTING_ID } })
    const entity = current ?? this.settingRepository.create({ id: SETTING_ID, ...FALLBACK_WATERMARK_SETTING })

    if (dto.enabled !== undefined) {
      entity.enabled = dto.enabled ? 1 : 0
      if (!entity.enabled) {
        entity.mode = 'off'
      } else if (entity.mode === 'off') {
        entity.mode = 'optional'
      }
    }
    if (dto.mode !== undefined) {
      entity.mode = dto.mode
      if (entity.mode === 'off') {
        entity.enabled = 0
      } else if (!entity.enabled) {
        entity.enabled = 1
      }
    }
    if (dto.content !== undefined) {
      entity.content = normalizeWatermarkContent(dto.content) || FALLBACK_WATERMARK_SETTING.content
    }
    if (dto.density !== undefined) {
      entity.density = dto.density
    }
    if (dto.opacity !== undefined) {
      entity.opacity = dto.opacity
    }
    if (dto.rotate !== undefined) {
      entity.rotate = dto.rotate
    }
    if (dto.fontSize !== undefined) {
      entity.fontSize = dto.fontSize
    }
    entity.updatedBy = operator ?? null
    entity.updatedAt = new Date()

    const saved = await this.settingRepository.save(entity)
    return this.toSettingSnapshot(saved)
  }

  private toSettingSnapshot(row: WatermarkSettingEntity): WatermarkSettingSnapshot {
    return {
      enabled: Number(row.enabled),
      mode: row.mode,
      content: row.content,
      density: row.density as WatermarkDensity,
      opacity: Number(row.opacity),
      rotate: Number(row.rotate),
      fontSize: Number(row.fontSize)
    }
  }
}
