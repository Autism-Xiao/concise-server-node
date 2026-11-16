import { createHmac } from 'crypto'
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

/** 仅 https：签名密钥的验证场景在明文 http 下会被中间人拆掉 */
function assertHttpsUrl(url: string): void {
  if (!url.startsWith('https://')) throw new BadRequestException('回调地址必须是 https://')
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

  async findOne(id: string): Promise<SysWebhookEntity> {
    const hook = await this.hookRepo.findOne({ where: { id, delFlag: '0' } })
    if (!hook) throw new NotFoundException('订阅不存在')
    return hook
  }

  async create(input: WebhookWriteInput): Promise<SysWebhookEntity> {
    assertHttpsUrl(input.url)
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
      assertHttpsUrl(input.url)
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
   */
  dispatch(event: WebhookEventKey, data: Record<string, unknown>): void {
    void this.dispatchAsync(event, data)
  }

  private async dispatchAsync(event: WebhookEventKey, data: Record<string, unknown>): Promise<void> {
    let hooks: SysWebhookEntity[]
    try {
      hooks = await this.hookRepo.find({ where: { event, status: '0', delFlag: '0' } })
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
          signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS)
        })
        lastCode = response.status
        // 2xx 视为投递成功；接收方必须拿这个当约定，4xx/5xx 一律重试
        if (response.status >= 200 && response.status < 300) {
          await this.recordDelivery(hook, event, '0', attempts, lastCode, null, body)
          return
        }
        lastError = `HTTP ${response.status}`
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
