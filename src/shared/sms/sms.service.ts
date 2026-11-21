import { Injectable, Logger } from '@nestjs/common'

import { SystemConfigService } from '../../modules/system/config/system-config.service'

/**
 * 短信通道（阿里云 / 腾讯云）
 *
 * 与邮件通道（shared/mailer）同一套纪律：
 * - **凭证走环境变量**（SMS_*），密钥不进 sys_config —— 那张表的内容会在「系统参数」页面出镜；
 * - **开关走 sys_config**：`sms.enabled` 在线开关、`sms.provider` 选通道（aliyun / tencent）；
 * - **降级 dry-run**：没配凭证或没开开关时不抛错，把发送内容留在内存 outbox（GET /v1/sms/outbox 可取），
 *   本地开发不用真买短信包也能把「验证码」从 outbox 里取出来走通流程；
 * - 不引 SDK：阿里云 RPC 签名（HMAC-SHA1）与腾讯云 TC3 签名（HMAC-SHA256）都是纯 node:crypto 实现，
 *   省两个重依赖，出问题也只在自己这层排查。
 */

/** 发送结果：dryRun = 没真发，只进了 outbox */
export interface SmsSendResult {
  ok: boolean
  dryRun?: boolean
  error?: string
  /** 通道侧回执 ID（真发成功时） */
  bizId?: string
}

/** outbox 一条记录（dry-run 带 body 便于本地取验证码） */
export interface SmsOutboxItem {
  at?: string
  to: string
  provider: string
  template: string
  ok: boolean
  dryRun: boolean
  error?: string
  preview?: Record<string, string>
  /** 通道侧回执 ID（真发成功时） */
  bizId?: string
}

export type SmsParams = Record<string, string | number>

interface AliyunSettings {
  accessKeyId: string
  accessKeySecret: string
  signName: string
  endpoint: string
}

interface TencentSettings {
  secretId: string
  secretKey: string
  sdkAppId: string
  signName: string
  endpoint: string
}

const OUTBOX_LIMIT = 20
const SEND_TIMEOUT_MS = 10_000

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name)
  private outbox: SmsOutboxItem[] = []

  constructor(private readonly config: SystemConfigService) {}

  /** 当前选中的通道名（sys_config sms.provider，缺省 aliyun） */
  private async provider(): Promise<'aliyun' | 'tencent'> {
    const name = (await this.config.getString('sms.provider', 'aliyun')).trim().toLowerCase()
    return name === 'tencent' ? 'tencent' : 'aliyun'
  }

  private aliyunSettings(): AliyunSettings {
    return {
      accessKeyId: (process.env.SMS_ALIYUN_ACCESS_KEY_ID ?? '').trim(),
      accessKeySecret: process.env.SMS_ALIYUN_ACCESS_KEY_SECRET ?? '',
      signName: (process.env.SMS_ALIYUN_SIGN_NAME ?? '').trim(),
      // 固定公网入口；内网自建网关不在支持范围
      endpoint: (process.env.SMS_ALIYUN_ENDPOINT ?? 'https://dysmsapi.aliyuncs.com').trim()
    }
  }

  private tencentSettings(): TencentSettings {
    return {
      secretId: (process.env.SMS_TENCENT_SECRET_ID ?? '').trim(),
      secretKey: process.env.SMS_TENCENT_SECRET_KEY ?? '',
      sdkAppId: (process.env.SMS_TENCENT_SDK_APP_ID ?? '').trim(),
      signName: (process.env.SMS_TENCENT_SIGN_NAME ?? '').trim(),
      endpoint: (process.env.SMS_TENCENT_ENDPOINT ?? 'https://sms.tencentcloudapi.com').trim()
    }
  }

  /** 指定通道的凭证是否齐全（不看开关） */
  isConfigured(provider?: 'aliyun' | 'tencent'): boolean {
    const p = provider ?? 'aliyun'
    return p === 'aliyun' ? isFilled(Object.values(this.aliyunSettings())) : isFilled(Object.values(this.tencentSettings()))
  }

  /** 是否允许真实发送（配置齐全 + 开关打开） */
  async isEnabled(): Promise<boolean> {
    const provider = await this.provider()
    return (await this.config.getBoolean('sms.enabled', false)) && this.isConfigured(provider)
  }

  /** 管理端状态（凭证只出 Key ID 前几位脱敏，secret 永不返回） */
  async status(): Promise<Record<string, unknown>> {
    const provider = await this.provider()
    const configured = this.isConfigured(provider)
    const mask = (v: string) => (v ? `${v.slice(0, 4)}****${v.slice(-4)}` : null)
    return {
      provider,
      enabled: await this.config.getBoolean('sms.enabled', false),
      configured,
      aliyun: {
        accessKeyId: mask(this.aliyunSettings().accessKeyId),
        signName: this.aliyunSettings().signName || null
      },
      tencent: {
        secretId: mask(this.tencentSettings().secretId),
        sdkAppId: this.tencentSettings().sdkAppId || null,
        signName: this.tencentSettings().signName || null
      },
      outboxSize: this.outbox.length
    }
  }

  /**
   * 发一条短信。
   * 未配置/未开启 → dry-run（写 outbox，ok:true），不抛错 —— 「忘了配短信」不该把
   * 依赖短信的登录/提醒接口打挂，调用方按返回值自己决定要不要提示。
   */
  async send(to: string, templateCode: string, params: SmsParams = {}): Promise<SmsSendResult> {
    const phone = (to ?? '').trim().replace(/^\+86/, '')
    if (!/^1\d{10}$/.test(phone)) return this.fail('手机号格式不正确')
    if (!templateCode) return this.fail('模板 Code 不能为空')

    const provider = await this.provider()
    const enabled = await this.isEnabled()
    if (!enabled) {
      const reason = this.isConfigured(provider) ? `短信通道已关闭（sms.enabled=false）` : `未配置 ${provider} 短信凭证（SMS_* 环境变量）`
      this.record({ to: phone, provider, template: templateCode, ok: true, dryRun: true, error: reason, preview: stringifyParams(params) })
      this.logger.warn(`[dry-run] ${reason}，短信未发送：to=${phone} template=${templateCode}`)
      return { ok: true, dryRun: true }
    }

    try {
      const result = provider === 'aliyun' ? await this.sendViaAliyun(phone, templateCode, params) : await this.sendViaTencent(phone, templateCode, params)
      if (result.ok) {
        this.record({ to: phone, provider, template: templateCode, ok: true, dryRun: false, bizId: result.bizId })
        this.logger.log(`短信已发送：provider=${provider} to=${phone} template=${templateCode}`)
        return { ok: true, bizId: result.bizId }
      }
      this.record({ to: phone, provider, template: templateCode, ok: false, dryRun: false, error: result.error })
      this.logger.error(`短信发送失败：provider=${provider} to=${phone} 原因=${result.error}`)
      return this.fail(result.error ?? '发送失败')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.record({ to: phone, provider, template: templateCode, ok: false, dryRun: false, error: message })
      return this.fail(message)
    }
  }

  /** 测试发送：只有真发成功才算通过（dry-run 直接报未开启，避免"测试通过但根本没配"） */
  async sendTest(to: string, operator?: string): Promise<SmsSendResult> {
    const provider = await this.provider()
    if (!this.isConfigured(provider)) return this.fail(`未配置 ${provider} 短信凭证（SMS_* 环境变量）`)
    if (!(await this.config.getBoolean('sms.enabled', false))) return this.fail('短信通道未开启（sms.enabled=false），开启后再测试')
    return this.send(to, 'TEST', { content: `这是一条来自管理后台的测试短信（${operator ?? 'admin'}，${new Date().toISOString()}）` })
  }

  /** 最近发送记录（最近在前；dry-run 带参数） */
  getOutbox(limit = OUTBOX_LIMIT): SmsOutboxItem[] {
    return this.outbox.slice(-limit).reverse()
  }

  /* ---------- 阿里云：dysmsapi RPC + HMAC-SHA1 签名 ---------- */

  private async sendViaAliyun(phone: string, templateCode: string, params: SmsParams): Promise<{ ok: boolean; bizId?: string; error?: string }> {
    const s = this.aliyunSettings()
    const settings: AliyunSettings = { ...s, signName: s.signName || (process.env.SMS_ALIYUN_SIGN_NAME ?? '') }
    const requestParams: Record<string, string> = {
      Action: 'SendSms',
      Version: '2017-05-25',
      Format: 'JSON',
      AccessKeyId: settings.accessKeyId,
      SignatureMethod: 'HMAC-SHA1',
      SignatureVersion: '1.0',
      SignatureNonce: randomHex(16),
      Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      PhoneNumbers: phone,
      SignName: settings.signName,
      TemplateCode: templateCode === 'TEST' ? 'SMS_TEST_FALLBACK' : templateCode,
      TemplateParam: JSON.stringify(stringifyParams(params))
    }
    // 签名规范：按 key 排序拼 query，再以 GET 方式 HMAC-SHA1（key = secret + '&'）
    const canonical = Object.keys(requestParams)
      .sort()
      .map(key => `${percentEncode(key)}=${percentEncode(requestParams[key])}`)
      .join('&')
    const stringToSign = `GET&${percentEncode('/')}&${percentEncode(canonical)}`
    const signature = crypto.createHmac('sha1', `${settings.accessKeySecret}&`).update(stringToSign).digest('base64')
    const url = `${settings.endpoint}/?Signature=${percentEncode(signature)}&${canonical}`

    const json = await fetchJson(url)
    if (json.Code === 'OK') return { ok: true, bizId: json.BizId }
    return { ok: false, error: `${json.Code ?? 'Unknown'}: ${json.Message ?? '无返回信息'}` }
  }

  /* ---------- 腾讯云：TC3-HMAC-SHA256 签名 ---------- */

  private async sendViaTencent(phone: string, templateCode: string, params: SmsParams): Promise<{ ok: boolean; bizId?: string; error?: string }> {
    const s = this.tencentSettings()
    const payload = JSON.stringify({
      PhoneNumberSet: [`+86${phone}`],
      SmsSdkAppId: s.sdkAppId,
      SignName: s.signName,
      TemplateId: templateCode === 'TEST' ? 'TEST_FALLBACK' : templateCode,
      TemplateParamSet: Object.values(stringifyParams(params))
    })
    const tencent = await tc3Request(s.endpoint, 'sms', '2021-01-11', 'SendSms', s.secretId, s.secretKey, payload)
    if (tencent.Response?.Error) {
      return { ok: false, error: `${tencent.Response.Error.Code}: ${tencent.Response.Error.Message}` }
    }
    return { ok: true, bizId: tencent.Response?.SendStatusSet?.[0]?.SerialNo }
  }

  private record(item: SmsOutboxItem): void {
    this.outbox.push({ ...item, at: new Date().toISOString() })
    if (this.outbox.length > OUTBOX_LIMIT * 2) this.outbox = this.outbox.slice(-OUTBOX_LIMIT)
  }

  private fail(error: string): SmsSendResult {
    return { ok: false, error }
  }
}

/* ---------- 工具函数（供单测直接引用） ---------- */

import crypto from 'node:crypto'

function isFilled(values: string[]): boolean {
  return values.every(v => Boolean(v && v.trim()))
}

function randomHex(bytes: number): string {
  return crypto.randomBytes(bytes).toString('hex')
}

/** 阿里云 RPC 签名专用百分号编码（RFC3986：~ 不转义） */
export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/\+/g, '%20').replace(/\*/g, '%2A').replace(/%7E/g, '~')
}

/** 腾讯云 TC3 签名请求（POST JSON，服务签名头 X-TC-*） */
export async function tc3Request(
  endpoint: string,
  service: string,
  version: string,
  action: string,
  secretId: string,
  secretKey: string,
  payload: string
): Promise<Record<string, any>> {
  const timestamp = Math.floor(Date.now() / 1000)
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const hashedPayload = crypto.createHash('sha256').update(payload).digest('hex')
  const canonicalRequest = ['POST', '/', '', `content-type:application/json\nhost:${new URL(endpoint).host}\n`, 'content-type;host', hashedPayload].join('\n')
  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(timestamp),
    `${date}/${service}/tc3_request`,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex')
  ].join('\n')

  const kDate = crypto.createHmac('sha256', `TC3${secretKey}`).update(date).digest()
  const kService = crypto.createHmac('sha256', kDate).update(service).digest()
  const kSigning = crypto.createHmac('sha256', kService).update('tc3_request').digest()
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex')

  const json = await fetchJson(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Host: new URL(endpoint).host,
      'X-TC-Action': action,
      'X-TC-Version': version,
      'X-TC-Timestamp': String(timestamp),
      Authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${date}/${service}/tc3_request, SignedHeaders=content-type;host, Signature=${signature}`
    },
    body: payload,
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
  })
  return json
}

async function fetchJson(url: string, init?: RequestInit): Promise<Record<string, any>> {
  const res = await fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(SEND_TIMEOUT_MS) })
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`短信网关返回非 JSON（HTTP ${res.status}）：${text.slice(0, 120)}`)
  }
}

function stringifyParams(params: SmsParams): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(params)) out[key] = String(value)
  return out
}
