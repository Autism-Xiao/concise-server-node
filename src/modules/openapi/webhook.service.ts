import { createHmac } from 'crypto'
import { isIP } from 'net'
import { lookup as dnsLookup } from 'dns/promises'
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import type { Repository } from 'typeorm'

import { Pagination } from '../../helper/paginate'
import { TenantContext } from '../../shared/tenant/tenant.context'
import { randomId32 } from '../../utils/password.util'
import { SysWebhookDeliveryEntity } from './entities/sys-webhook-delivery.entity'
import { SysWebhookEntity } from './entities/sys-webhook.entity'
import { WEBHOOK_RETRY_DELAYS_MS, WEBHOOK_TIMEOUT_MS, WEBHOOK_EVENT_KEYS, type WebhookEventKey } from './openapi.constants'

/** 派发给订阅方的数据信封：外层是元信息，data 才是业务内容（对接方只解析 data 也不用关心版本变化） */
export interface WebhookEnvelope {
  event: string
  tenantId: number
  /** ISO 8601，事件发生时间（不是投递时间——重试时两者会差几秒） */
  occurredAt: string
  deliveryId: string
  data: Record<string, unknown>
}

export interface WebhookWriteInput {
  event: string
  url: string
  appId?: string | null
  status?: string
}

/**
 * 回调地址合法性（含 SSRF 防护）：只允许 https 公网地址。
 *
 * 之前只查 `startsWith('https://')` —— 任何人把订阅 URL 填成
 * `https://169.254.169.254/...`（云元数据）或内网服务地址，就能让服务器替他发内网请求
 * （响应码还进投递流水，等于一个可以盲扫内网的探针）。现在三层拦截：
 *  1. 协议必须 https（签名密钥的验证场景在明文 http 下会被中间人拆掉）；
 *  2. 主机名是 IP 字面量时直接判段（RFC1918 / 环回 / 链路本地 169.254 / CGNAT / 保留段全拒）；
 *  3. 域名先 DNS 解析，解析结果里有任何一个私网地址就整条拒绝（覆盖多记录域名）。
 * 注：派发时 fetch 用 redirect: 'manual' 不跟随重定向（3xx 一律按投递失败处理），
 * 否则公网地址 302 跳内网就把前面的校验绕光了。
 */
async function assertPublicCallbackUrl(url: string): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new BadRequestException('回调地址不是合法的 URL')
  }
  if (parsed.protocol !== 'https:') {
    throw new BadRequestException('回调地址必须是 https://')
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (hostname === 'localhost' || isPrivateAddress(hostname)) {
    throw new BadRequestException('回调地址不允许指向内网 / 环回 / 链路本地地址')
  }
  if (isIP(hostname)) return
  let records: Array<{ address: string }>
  try {
    records = await dnsLookup(hostname, { all: true, verbatim: true })
  } catch {
    throw new BadRequestException('回调域名无法解析，请检查拼写')
  }
  if (records.some(record => isPrivateAddress(record.address))) {
    throw new BadRequestException('回调域名解析到内网 / 保留地址，已拒绝')
  }
}

/** IPv4/IPv6 是否属于私网 / 环回 / 链路本地 / 保留段（SSRF 黑名单） */
function isPrivateAddress(address: string): boolean {
  const v4 = isIP(address)
  if (v4 === 4) {
    const parts = address.split('.').map(Number)
    const [a, b] = [parts[0]!, parts[1]!]
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64/10
      (a === 169 && b === 254) || // 链路本地（含云元数据 169.254.169.254）
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) || // 192.0.0/24 与 192.0.2/24 测试段
      (a === 198 && (b === 18 || b === 19)) || // 198.18/15 基准测试段
      a >= 224 // 组播 + 保留段
    )
  }
  if (v4 === 6) {
    const lower = address.toLowerCase()
    if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7)) // IPv4 映射地址
    if (lower === '::' || lower === '::1') return true // 未指定 / 环回
    const first = lower.split(':')[0] ?? ''
    const head = parseInt(first.slice(0, 4) || '0', 16)
    if ((head & 0xfe00) === 0xfc00) return true // fc00::/7 唯一本地
    if ((head & 0xffc0) === 0xfe80) return true // fe80::/10 链路本地
    if ((head & 0xff00) === 0xff00) return true // ff00::/8 组播
    return head === 0x2001 && (lower.startsWith('2001:db8') || lower.startsWith('2001:db7')) // 文档段
  }
  return false
}

/**
 * Webhook 订阅与事件派发
 *
 * 派发语义（务实版，不引消息队列）：
 *  - `dispatch()` 同步返回、异步投递：业务写路径永远不等网络回调；
 *  - 失败按 1s / 5s / 15s 重试三次（共 4 次尝试），每次重试同一个 deliveryId，接收方靠它幂等；
 *  - 只记**最终**结果一行流水 —— 排查「对方说没收到」看 attempts 和 error 就够，
 *    需要完整轨迹时再上队列也不迟。
 */
@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name)

  constructor(
    @InjectRepository(SysWebhookEntity)
    private readonly hookRepo: Repository<SysWebhookEntity>,
    @InjectRepository(SysWebhookDeliveryEntity)
    private readonly deliveryRepo: Repository<SysWebhookDeliveryEntity>
  ) {}

  /* ------------------------------ 管理端 ------------------------------ */

  async list(options: { page?: number; pageSize?: number }) {
    const page = Math.max(1, Math.trunc(Number(options.page) || 1))
    const pageSize = Math.min(100, Math.max(1, Math.trunc(Number(options.pageSize) || 20)))

    const qb = this.hookRepo.createQueryBuilder('h').where('h.del_flag = :del', { del: '0' }).orderBy('h.create_time', 'DESC')
    const tenantId = TenantContext.filterTenantId()
    if (tenantId !== null) qb.andWhere('h.tenant_id = :tenantId', { tenantId })

    const total = await qb.getCount()
    const rows = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany()
    return new Pagination(rows, total, page, pageSize)
  }

  /** 单个订阅：严格按归属租户隔离（update/delete/流水/测试派发都从这里过），防跨租户 IDOR */
  async findOne(id: string): Promise<SysWebhookEntity> {
    const base = { id, delFlag: '0' } as const
    const tenantId = TenantContext.filterTenantId()
    const hook = await this.hookRepo.findOne({ where: tenantId === null ? base : { ...base, tenantId } })
    if (!hook) throw new NotFoundException('订阅不存在')
    return hook
  }

  async create(input: WebhookWriteInput): Promise<SysWebhookEntity> {
    await assertPublicCallbackUrl(input.url)
    this.assertEvent(input.event)
    const hook = this.hookRepo.create({
      id: randomId32(),
      tenantId: TenantContext.currentTenantId() ?? 0,
      appId: input.appId ?? null,
      event: input.event,
      url: input.url,
      // 64 位随机（256 位熵）：签名密钥必须不可猜，否则任何人都能伪造事件
      secret: randomId32() + randomId32(),
      status: input.status ?? '0',
      delFlag: '0',
      createTime: new Date()
    })
    await this.hookRepo.insert(hook)
    return hook
  }

  async update(id: string, input: Partial<WebhookWriteInput>): Promise<SysWebhookEntity> {
    await this.findOne(id)
    const patch: Partial<SysWebhookEntity> = { updateTime: new Date() }
    if (input.url !== undefined) {
      await assertPublicCallbackUrl(input.url)
      patch.url = input.url
    }
    if (input.event !== undefined) {
      this.assertEvent(input.event)
      patch.event = input.event
    }
    if (input.appId !== undefined) patch.appId = input.appId
    if (input.status !== undefined) patch.status = input.status
    await this.hookRepo.update(id, patch)
    return this.findOne(id)
  }

  /** 删除（软删）：停发即删，历史投递流水保留（有 audit 价值） */
  async delete(id: string): Promise<void> {
    await this.findOne(id)
    await this.hookRepo.update(id, { delFlag: '1', updateTime: new Date() })
  }

  /** 某订阅的投递流水（倒序） */
  async listDeliveries(webhookId: string, options: { page?: number; pageSize?: number }) {
    await this.findOne(webhookId)
    const page = Math.max(1, Math.trunc(Number(options.page) || 1))
    const pageSize = Math.min(100, Math.max(1, Math.trunc(Number(options.pageSize) || 20)))
    const qb = this.deliveryRepo.createQueryBuilder('d').where('d.webhook_id = :id', { id: webhookId }).orderBy('d.create_time', 'DESC')
    const total = await qb.getCount()
    const rows = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany()
    return new Pagination(rows, total, page, pageSize)
  }

  /* ------------------------------ 派发 ------------------------------ */

  /**
   * 派发事件给所有启用的订阅（fire-and-forget，业务侧直接调用不用 await）
   * 没有订阅就一行流水都不写 —— 别让"没人订阅"这件事污染投递日志。
   *
   * 租户隔离：业务事件必须带 opts.tenantId（事件主体的归属租户）——
   * 订阅只收到「自己租户（或平台 tenant_id=0）」的事件，之前是全库广播，
   * A 租户的用户变更（含姓名）会推给 B 租户填的回调地址。
   */
  dispatch(event: WebhookEventKey, data: Record<string, unknown>, opts?: { tenantId?: number | null }): void {
    void this.dispatchAsync(event, data, opts?.tenantId)
  }

  private async dispatchAsync(event: WebhookEventKey, data: Record<string, unknown>, eventTenantId?: number | null): Promise<void> {
    let hooks: SysWebhookEntity[]
    try {
      const qb = this.hookRepo
        .createQueryBuilder('h')
        .where('h.event = :event', { event })
        .andWhere('h.status = :status', { status: '0' })
        .andWhere('h.del_flag = :del', { del: '0' })
      if (eventTenantId != null && Number(eventTenantId) > 0) {
        // 本租户的事件：发给归属租户相同的订阅 + 平台级订阅（tenant_id = 0）
        qb.andWhere('(h.tenant_id = :tid OR h.tenant_id = 0)', { tid: Number(eventTenantId) })
      } else {
        // 拿不到归属租户的事件只发平台级订阅，宁缺勿滥
        qb.andWhere('h.tenant_id = 0')
      }
      hooks = await qb.getMany()
    } catch (error) {
      this.logger.warn(`webhook 派发查订阅失败：${error instanceof Error ? error.message : String(error)}`)
      return
    }
    for (const hook of hooks) {
      // 每个 URL 独立 deliveryId：同一事件发多个订阅，各自幂等、各自重试
      void this.deliver(hook, event, data)
    }
  }

  /** 单个订阅的投递（含重试）。所有异常吞掉：派发失败只进流水，绝不抛给业务 */
  private async deliver(hook: SysWebhookEntity, event: WebhookEventKey, data: Record<string, unknown>): Promise<void> {
    const deliveryId = randomId32()
    const occurredAt = new Date().toISOString()
    const tenantId = hook.tenantId
    const body = JSON.stringify({ event, tenantId, occurredAt, deliveryId, data })
    const signature = `sha256=${createHmac('sha256', hook.secret).update(body, 'utf8').digest('hex')}`

    let attempts = 0
    let lastCode: number | null = null
    let lastError: string | null = null

    for (const delay of [0, ...WEBHOOK_RETRY_DELAYS_MS]) {
      if (delay > 0) await sleep(delay)
      attempts += 1
      try {
        const response = await fetch(hook.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Concise-Event': event,
            'X-Concise-Delivery': deliveryId,
            'X-Concise-Signature': signature,
            'User-Agent': 'concise-server-webhook/1.0'
          },
          body,
          // 不跟随重定向：公网回调 302 跳内网/元数据地址会把地址校验整个绕掉（SSRF），
          // 3xx 一律按投递失败处理，对接方请直接填最终地址
          redirect: 'manual',
          signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS)
        })
        lastCode = response.status
        // 2xx 视为投递成功；接收方必须拿这个当约定，4xx/5xx 一律重试
        if (response.status >= 200 && response.status < 300) {
          await this.recordDelivery(hook, event, '0', attempts, lastCode, null, body)
          return
        }
        lastError =
          response.status >= 300 && response.status < 400 ? `HTTP ${response.status}（不允许重定向，请直接填最终回调地址）` : `HTTP ${response.status}`
      } catch (error) {
        lastCode = null
        lastError = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 490) : String(error)
      }
    }
    await this.recordDelivery(hook, event, '1', attempts, lastCode, lastError, body)
    this.logger.warn(`webhook 投递失败（${attempts} 次）：${hook.event} -> ${hook.url}，${lastError ?? ''}`)
  }

  private async recordDelivery(
    hook: SysWebhookEntity,
    event: string,
    status: '0' | '1',
    attempts: number,
    responseCode: number | null,
    error: string | null,
    body: string
  ): Promise<void> {
    try {
      await this.deliveryRepo.insert({
        id: randomId32(),
        webhookId: hook.id,
        event,
        status,
        attempts,
        responseCode,
        error: error ? error.slice(0, 500) : null,
        payload: body.slice(0, 5000),
        createTime: new Date()
      })
    } catch (recordError) {
      // 流水写失败只告警 —— 投递结果丢了也不能影响业务
      this.logger.warn(`webhook 投递流水写入失败：${recordError instanceof Error ? recordError.message : String(recordError)}`)
    }
  }

  /** 管理端连通性测试：直接派发一条 webhook.test 事件（走真实投递 + 流水，能在流水页看到结果） */
  async sendTest(id: string): Promise<{ deliveryIdHint: string }> {
    const hook = await this.findOne(id)
    this.deliver(hook, 'webhook.test', { message: '这是一条连通性测试事件', webhookId: hook.id })
    return { deliveryIdHint: '投递已发起，请稍后在投递流水里查看结果' }
  }

  private assertEvent(event: string): void {
    if (!WEBHOOK_EVENT_KEYS.includes(event as WebhookEventKey)) {
      throw new BadRequestException(`不支持的事件：${event}（可选：${WEBHOOK_EVENT_KEYS.join(', ')}）`)
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
