import { HttpStatus, Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'

import { BizErrorCode } from '../../../common/enums/biz-error-code.enum'
import { BizException } from '../../../common/exceptions/biz.exception'
import { normalizeBatchIds } from '../../../helper/crud/batch-delete'
import { hasSuperRole } from '../../../utils/super-role.util'
import { normalizeWatermarkContent, renderWatermarkLines } from '../../../utils/watermark-template.util'
import { UserService } from '../../user/user.service'
import { type BatchWatermarkMode } from './dto/batch-user-watermark.dto'
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
  /** 鉴权时挂载的角色（停用角色已被 JwtStrategy 裁掉），用于判定是否超管 */
  roles?: Array<{ roleCode?: string | null }> | null
}

/** 非超管用户看到的锁定原因：水印开关只归管理员，普通账号不能自行关闭（防绕过留痕要求） */
export const USER_WATERMARK_LOCKED_REASON = '水印由管理员统一设置，如需调整请联系管理员'

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
 * 批量设置水印的结果
 *
 * 与批量启停同语义：一次请求逐条结算，返回成功条数 + 跳过明细（原因直接给前端展示）。
 */
export interface BatchWatermarkOutcome {
  mode: BatchWatermarkMode
  updated: number
  skipped: Array<{ id: string; reason: string }>
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
    @InjectRepository(UserWatermarkEntity) private readonly userRepository: Repository<UserWatermarkEntity>,
    /** 只用于批量操作前确认目标用户存在（UserModule 不反向依赖本模块，无循环引用） */
    private readonly userService: UserService
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
    // 开关权只给超管：普通用户即便在 optional 模式下也不能自行关闭水印（否则留痕要求形同虚设）；
    // 全局 off / 用户 enforced / 全站 forced 的既有原因优先展示，没有更具体原因时才用统一话术
    const isAdmin = hasSuperRole(user.roles)

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
      editable: isAdmin && state.editable,
      reason: isAdmin ? state.reason : (state.reason ?? USER_WATERMARK_LOCKED_REASON),
      custom: {
        enabled: custom?.enabled ?? null,
        content: custom?.content ?? null,
        density: custom?.density ?? null
      }
    }
  }

  /** 用户改自己的水印：只有超管可以（其余人由管理员在用户管理里逐人设定） */
  async updateMine(user: WatermarkUserLike, dto: UpdateMyWatermarkDto, ip?: string | null): Promise<ResolvedWatermark> {
    if (!hasSuperRole(user.roles)) {
      throw new BizException(BizErrorCode.FORBIDDEN, USER_WATERMARK_LOCKED_REASON, HttpStatus.FORBIDDEN)
    }
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

  /**
   * 批量设置用户水印（用户管理列表勾选后一次提交）
   *
   * 三档动作映射到 enabled/enforced，语义与单个用户弹窗的「管控方式」一致：
   *  - on      enabled=1 + enforced=1（全局关掉也照样显示）
   *  - off     enabled=0 + enforced=2（全局强制开也不显示）
   *  - inherit 清掉个人开关/内容/密度，enforced 归 0，重新跟随全局
   *
   * 不存在或已软删的用户直接跳过并回传原因（与批量启停同语义：单条失败不阻断其他条）；
   * 全程一个事务，避免刷到一半留下半开半关的中间态。
   */
  async batchUpdateForUsers(ids: string[], mode: BatchWatermarkMode, operator?: string | null): Promise<BatchWatermarkOutcome> {
    const clean = normalizeBatchIds(ids)
    const existing = await this.userService.findExistingBriefs(clean)
    const foundIds = new Set(existing.map(user => user.id))
    const skipped: BatchWatermarkOutcome['skipped'] = clean.filter(id => !foundIds.has(id)).map(id => ({ id, reason: '用户不存在或已删除' }))

    if (existing.length > 0) {
      const now = new Date()
      await this.userRepository.manager.transaction(async manager => {
        // 事务内必须用 manager 取仓库，默认连接看不到未提交数据
        const repo = manager.getRepository(UserWatermarkEntity)
        const rows = await repo.find({ where: { userId: In(existing.map(user => user.id)) } })
        const byUserId = new Map(rows.map(row => [row.userId, row]))
        for (const user of existing) {
          const entity = byUserId.get(user.id) ?? repo.create({ userId: user.id, enforced: 0 })
          if (mode === 'on') {
            entity.enabled = 1
            entity.enforced = 1
          } else if (mode === 'off') {
            entity.enabled = 0
            entity.enforced = 2
          } else {
            // 恢复跟随全局 = 把个人配置整行清空（只清 enabled 会留下"跟全局但文案还是自己的"的怪状态）
            entity.enabled = null
            entity.enforced = 0
            entity.content = null
            entity.density = null
          }
          entity.updatedBy = operator ?? null
          entity.updatedAt = now
          await repo.save(entity)
        }
      })
    }

    return { mode, updated: existing.length, skipped }
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
