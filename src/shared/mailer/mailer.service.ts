import { Injectable, Logger } from '@nestjs/common'
import { createTransport, type Transporter } from 'nodemailer'

import { SystemConfigService } from '../../modules/system/config/system-config.service'
import { renderResetCodeMail, renderTestMail, type RenderedMail } from './mailer.templates'

/**
 * SMTP 邮件通道
 *
 * 配置分两处，刻意不合并：
 * - **连接信息（host/port/user/password）走环境变量**：密码是密钥，不能进 `sys_config`
 *   —— 那张表的内容会原样出现在「系统参数」页面，任何有 `system:config:list` 权限的人都能看到。
 * - **开关与信封走 `sys_config`**：`mail.enabled` 可以在线开关，`mail.from` 是展示信息，改它不需要重启。
 *
 * 降级策略：没配置或没开启时**不抛错、退化成 dry-run**，把邮件内容留在内存 outbox 里
 * （`GET /v1/mail/outbox` 可取，仅 admin）。这样本地开发不用真配 SMTP，也能把验证码取出来；
 * 生产必须把 `mail.enabled` 打开，否则用户收不到任何信。
 */

/** 发信结果：failure 时 error 是给人看的原因 */
export interface MailSendResult {
  ok: boolean
  /** true = 没真发，只放进了 outbox */
  dryRun?: boolean
  error?: string
}

/** outbox 里的一条记录（dry-run 时带正文，方便本地取验证码） */
export interface MailOutboxItem {
  at: string
  to: string
  subject: string
  ok: boolean
  dryRun: boolean
  error?: string
  preview?: string
}

interface SmtpSettings {
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
}

/** 只在内存里留最近 N 封，给本地调试用；不是队列，重启即丢 */
const OUTBOX_LIMIT = 20
/** 发信超时：SMTP 卡住时不能让登录/重置接口一直挂着 */
const SEND_TIMEOUT_MS = 10_000

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name)
  private transporter: Transporter | null = null
  /** 建 transporter 时的配置指纹，配置变了就重建 */
  private transporterSignature = ''
  private outbox: MailOutboxItem[] = []

  constructor(private readonly config: SystemConfigService) {}

  /** SMTP 连接信息来自环境变量（可能是空值，空即未配置） */
  private settings(): SmtpSettings {
    const port = Number(process.env.MAIL_SMTP_PORT ?? 465)
    return {
      host: (process.env.MAIL_SMTP_HOST ?? '').trim(),
      port: Number.isFinite(port) && port > 0 ? port : 465,
      // 465 是隐式 TLS，587 一般走 STARTTLS（secure=false + 自动升级），默认按 465 处理
      secure: (process.env.MAIL_SMTP_SECURE ?? 'true').trim().toLowerCase() !== 'false',
      user: (process.env.MAIL_SMTP_USER ?? '').trim(),
      pass: process.env.MAIL_SMTP_PASS ?? ''
    }
  }

  /** 连接信息是否齐全（不看开关） */
  isConfigured(): boolean {
    const s = this.settings()
    return Boolean(s.host && s.user && s.pass)
  }

  /** 是否允许真实发信（配置齐全 + 开关打开） */
  async isEnabled(): Promise<boolean> {
    return (await this.config.getBoolean('mail.enabled', false)) && this.isConfigured()
  }

  /** 发信人：sys_config 的 mail.from 优先，其次 SMTP 账号 */
  private async resolveFrom(): Promise<string> {
    const configured = (await this.config.getString('mail.from')).trim()
    if (configured) return configured
    const { user } = this.settings()
    return user ? `系统通知 <${user}>` : '系统通知 <no-reply@localhost>'
  }

  /** 给管理端看的当前状态（密码永远不返回） */
  async status(): Promise<Record<string, unknown>> {
    const s = this.settings()
    return {
      enabled: await this.config.getBoolean('mail.enabled', false),
      configured: this.isConfigured(),
      host: s.host || null,
      port: s.host ? s.port : null,
      secure: s.host ? s.secure : null,
      user: s.user || null,
      from: await this.resolveFrom(),
      outboxSize: this.outbox.length
    }
  }

  /**
   * 发一封邮件。
   * 未配置/未开启 → dry-run（写 outbox，返回 ok:true + dryRun:true），不抛错，
   * 免得"忘记配 SMTP"直接让忘记密码接口 500。
   */
  async send(to: string, mail: RenderedMail): Promise<MailSendResult> {
    const recipient = (to ?? '').trim()
    if (!recipient) return this.fail('收件人为空')

    const enabled = await this.isEnabled()
    if (!enabled) {
      const reason = this.isConfigured() ? '邮件通道已关闭（mail.enabled=false）' : '未配置 SMTP（MAIL_SMTP_* 环境变量）'
      this.record({ to: recipient, subject: mail.subject, ok: true, dryRun: true, error: reason, preview: mail.html })
      this.logger.warn(`[dry-run] ${reason}，邮件未发送：to=${recipient} subject=${mail.subject}`)
      return { ok: true, dryRun: true }
    }

    try {
      const transporter = this.getTransporter()
      await transporter.sendMail({ from: await this.resolveFrom(), to: recipient, subject: mail.subject, html: mail.html, text: mail.text })
      this.record({ to: recipient, subject: mail.subject, ok: true, dryRun: false })
      this.logger.log(`邮件已发送：to=${recipient} subject=${mail.subject}`)
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.record({ to: recipient, subject: mail.subject, ok: false, dryRun: false, error: message })
      // 不发正文、不记收件人邮箱以外的隐私；失败只记原因，由调用方决定要不要重试
      this.logger.error(`邮件发送失败：to=${recipient} subject=${mail.subject} 原因=${message}`)
      return this.fail(message)
    }
  }

  /** 重置密码验证码 */
  async sendResetCode(to: string, data: { realname?: string; code: string; ttlMinutes: number; ip?: string }): Promise<MailSendResult> {
    return this.send(to, renderResetCodeMail(data))
  }

  /** 测试信：只有真发成功才算通过（dry-run 直接报未开启，避免"测试通过但根本没配"） */
  async sendTest(to: string, operator?: string): Promise<MailSendResult> {
    if (!this.isConfigured()) return this.fail('未配置 SMTP（MAIL_SMTP_* 环境变量）')
    if (!(await this.config.getBoolean('mail.enabled', false))) return this.fail('邮件通道未开启（mail.enabled=false），开启后再测试')
    return this.send(to, renderTestMail({ operator, at: new Date().toISOString() }))
  }

  /** 连通性检查：只建连不发信，用于排查配置 */
  async verify(): Promise<{ ok: boolean; error?: string }> {
    if (!this.isConfigured()) return { ok: false, error: '未配置 SMTP（MAIL_SMTP_* 环境变量）' }
    try {
      await this.getTransporter().verify()
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.error(`SMTP 连通性检查失败：${message}`)
      return { ok: false, error: message }
    }
  }

  /** 最近发信记录（最近在前；dry-run 的带正文） */
  getOutbox(limit = OUTBOX_LIMIT): MailOutboxItem[] {
    return this.outbox.slice(-limit).reverse()
  }

  private getTransporter(): Transporter {
    const s = this.settings()
    const signature = `${s.host}:${s.port}:${s.secure}:${s.user}:${s.pass.length}`
    if (this.transporter && signature === this.transporterSignature) return this.transporter

    this.transporter?.close()
    this.transporter = createTransport({
      host: s.host,
      port: s.port,
      secure: s.secure,
      auth: { user: s.user, pass: s.pass },
      // 自签证书的内网服务器常见，这里不强行校验（真要严格，把配置加成一个参数）
      tls: { rejectUnauthorized: false },
      connectionTimeout: SEND_TIMEOUT_MS,
      greetingTimeout: SEND_TIMEOUT_MS,
      socketTimeout: SEND_TIMEOUT_MS
    })
    this.transporterSignature = signature
    return this.transporter
  }

  private record(item: Omit<MailOutboxItem, 'at'>): void {
    this.outbox.push({ at: new Date().toISOString(), ...item })
    if (this.outbox.length > OUTBOX_LIMIT) this.outbox = this.outbox.slice(-OUTBOX_LIMIT)
  }

  private fail(error: string): MailSendResult {
    return { ok: false, error }
  }
}
