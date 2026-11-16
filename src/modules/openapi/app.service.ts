import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { createHash, randomBytes } from 'crypto'
import type { Repository } from 'typeorm'

import { BizException } from '../../common/exceptions/biz.exception'
import { BizErrorCode } from '../../common/enums/biz-error-code.enum'
import { Pagination } from '../../helper/paginate'
import { TenantContext } from '../../shared/tenant/tenant.context'
import { randomId32 } from '../../utils/password.util'
import { APP_SCOPE_KEYS, type AppScopeKey } from './openapi.constants'
import { SysAppEntity } from './entities/sys-app.entity'
import { SysAppSecretEntity } from './entities/sys-app-secret.entity'

/** 创建/编辑应用时的入参形态 */
export interface AppWriteInput {
  appName: string
  scopes: string[]
  remark?: string
  status?: string
}

/** 创建 / 重置密钥的结果：明文 secret 只在这里出现这一次 */
export interface AppSecretOnce {
  clientId: string
  clientSecret: string
  secretPrefix: string
}

/**
 * 开放平台应用服务
 *
 * 密钥安全模型：
 *  - client_secret 明文只在 create / resetSecret 的返回值里出现一次，之后库里只有 sha256；
 *  - sha256 而不是 argon2：换取 token 是高频机器调用，慢哈希会把每次 token 请求拖慢几百毫秒；
 *    机器密钥本身就是 192 位随机数，没有弱口令问题，sha256 足够；
 *  - 轮换语义：resetSecret 撤销全部旧版本 + 发新版本，对接方有"新旧并存切换"的余地
 *    （先拿到新密钥、切完流量再撤销旧的）。
 */
@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name)

  constructor(
    @InjectRepository(SysAppEntity)
    private readonly appRepo: Repository<SysAppEntity>,
    @InjectRepository(SysAppSecretEntity)
    private readonly secretRepo: Repository<SysAppSecretEntity>
  ) {}

  /** scope 合法性：白名单外的值直接拒，不给"配了个打错字的 scope 然后查一晚上为什么 403"的机会 */
  assertScopes(scopes: string[]): void {
    if (!scopes.length) throw new BadRequestException('授权范围不能为空')
    const invalid = scopes.filter(scope => !APP_SCOPE_KEYS.includes(scope as AppScopeKey))
    if (invalid.length) {
      throw new BadRequestException(`无效的授权范围：${invalid.join(', ')}（可选：${APP_SCOPE_KEYS.join(', ')}）`)
    }
  }

  /** 应用列表（分页）：带有效密钥前缀，方便管理员识别"这把钥匙是什么时候发的" */
  async list(options: { page?: number; pageSize?: number }) {
    const page = Math.max(1, Math.trunc(Number(options.page) || 1))
    const pageSize = Math.min(100, Math.max(1, Math.trunc(Number(options.pageSize) || 20)))

    const qb = this.appRepo.createQueryBuilder('a').where('a.del_flag = :del', { del: '0' }).orderBy('a.create_time', 'DESC')
    const tenantId = TenantContext.filterTenantId()
    if (tenantId !== null) qb.andWhere('a.tenant_id = :tenantId', { tenantId })

    const total = await qb.getCount()
    const rows = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany()

    const withPrefix = await Promise.all(
      rows.map(async app => ({
        ...app,
        secretPrefixes: await this.activeSecretPrefixes(app.id)
      }))
    )
    // 库侧分页：total 来自 COUNT，不能用 toPagination（它按数组长度算 total）
    return new Pagination(withPrefix, total, page, pageSize)
  }

  /** 单个应用（编辑弹窗用） */
  async findOne(id: string): Promise<SysAppEntity> {
    const app = await this.appRepo.findOne({ where: { id, delFlag: '0' } })
    if (!app) throw new NotFoundException('应用不存在')
    return app
  }

  /** 创建应用：返回 client_id + client_secret（明文只此一次） */
  async create(input: AppWriteInput): Promise<{ app: SysAppEntity; secret: AppSecretOnce }> {
    this.assertScopes(input.scopes)
    const app = this.appRepo.create({
      id: randomId32(),
      tenantId: TenantContext.currentTenantId() ?? 0,
      appName: input.appName,
      clientId: `app_${randomBytes(8).toString('hex')}`,
      status: input.status ?? '0',
      scopes: JSON.stringify(input.scopes),
      remark: input.remark ?? null,
      delFlag: '0',
      createBy: TenantContext.userId() ?? null,
      createTime: new Date()
    })
    await this.appRepo.insert(app)
    const secret = await this.issueSecret(app)
    return { app, secret }
  }

  /** 编辑应用（名称 / 备注 / 授权范围 / 启停）；停用与改范围即时生效：scope/状态每次鉴权实时查库 */
  async update(id: string, input: Partial<AppWriteInput>): Promise<SysAppEntity> {
    await this.findOne(id)
    const patch: Partial<SysAppEntity> = { updateTime: new Date() }
    if (input.appName !== undefined) patch.appName = input.appName
    if (input.remark !== undefined) patch.remark = input.remark
    if (input.status !== undefined) patch.status = input.status
    if (input.scopes !== undefined) {
      this.assertScopes(input.scopes)
      patch.scopes = JSON.stringify(input.scopes)
    }
    await this.appRepo.update(id, patch)
    return this.findOne(id)
  }

  /** 删除（软删）：连带撤销全部密钥，避免"应用没了钥匙还能换 token"的悬挂状态 */
  async delete(id: string): Promise<void> {
    const app = await this.findOne(id)
    await this.appRepo.update(id, { delFlag: '1', updateTime: new Date() })
    await this.secretRepo.update({ appId: app.id, status: '0' }, { status: '1' })
  }

  /** 重置密钥：旧版本全部撤销，发新版本。返回明文只此一次 */
  async resetSecret(id: string): Promise<AppSecretOnce> {
    const app = await this.findOne(id)
    await this.secretRepo.update({ appId: app.id, status: '0' }, { status: '1' })
    return this.issueSecret(app)
  }

  /**
   * 换取令牌时的凭据校验（token 接口唯一入口）
   * 任何失败都给同一句报错：client_id 或 client_secret 错误 —— 不区分"应用不存在"和"密钥错"，
   * 否则等于帮攻击者枚举 client_id。
   */
  async verifyCredentials(clientId: string, clientSecret: string): Promise<SysAppEntity> {
    const app = await this.appRepo.findOne({ where: { clientId, delFlag: '0' } })
    if (!app || app.status !== '0') {
      throw new BizException(BizErrorCode.UNAUTHORIZED, 'client_id 或 client_secret 错误')
    }
    const secrets = await this.secretRepo.find({ where: { appId: app.id, status: '0' } })
    const presented = sha256Hex(clientSecret)
    const matched = secrets.find(secret => timingSafeEqualHex(secret.secretHash, presented))
    if (!matched) {
      throw new BizException(BizErrorCode.UNAUTHORIZED, 'client_id 或 client_secret 错误')
    }
    // last_used_at 失败不致命，别让统计写坏换取主流程
    void this.secretRepo.update(matched.id, { lastUsedAt: new Date() }).catch(() => undefined)
    return app
  }

  /** 解析应用的 scope 集合（签发令牌与 ApiScopeGuard 共用） */
  parseScopes(app: SysAppEntity): string[] {
    try {
      const parsed = JSON.parse(app.scopes ?? '[]')
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
    } catch {
      return []
    }
  }

  /**
   * 鉴权时解析应用令牌：应用必须存在、启用、未删除。
   * 每次开放请求都查库（单主键点查，代价可忽略）——
   * 换来的是「停用/删应用/改 scope」对**已签发令牌**即时生效，不暴露 2 小时窗口。
   */
  async resolveActiveApp(appId: string): Promise<SysAppEntity | null> {
    const app = await this.appRepo.findOne({ where: { id: appId, delFlag: '0' } })
    if (!app || app.status !== '0') return null
    return app
  }

  /** 发新密钥版本 */
  private async issueSecret(app: SysAppEntity): Promise<AppSecretOnce> {
    const clientSecret = `sk_${randomBytes(24).toString('hex')}`
    const row: SysAppSecretEntity = {
      id: randomId32(),
      appId: app.id,
      secretHash: sha256Hex(clientSecret),
      secretPrefix: clientSecret.slice(0, 8),
      status: '0',
      lastUsedAt: null,
      createTime: new Date()
    }
    await this.secretRepo.insert(row)
    this.logger.log(`应用 ${app.appName}(${app.clientId}) 发放了新密钥版本 ${row.secretPrefix}…`)
    return { clientId: app.clientId, clientSecret, secretPrefix: row.secretPrefix }
  }

  private async activeSecretPrefixes(appId: string): Promise<string[]> {
    const rows = await this.secretRepo.find({ where: { appId, status: '0' }, select: { secretPrefix: true } })
    return rows.map(row => `${row.secretPrefix}…`)
  }
}

/** sha256 十六进制（小写） */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** 常量时间比较两个 hex 串（防时序侧信道；密钥比对的标准姿势） */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
