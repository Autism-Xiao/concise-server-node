import { Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import Jimp from 'jimp'

import { BizErrorCode } from '../../../common/enums/biz-error-code.enum'
import { BizException } from '../../../common/exceptions/biz.exception'
import { RedisService } from '../../../shared/redis/redis.service'

/** 背景图尺寸（与前端 rc-slider-captcha 默认 bgSize 320x160 保持一致，避免缩放导致 x 误差） */
const BG_WIDTH = 320
const BG_HEIGHT = 160
/** 拼图条宽度（与组件默认 puzzleSize 一致，拼图为通高竖条） */
const PIECE_WIDTH = 60
/** 校验容差（像素）：拖动落点与答案的偏差范围内视为通过 */
const TOLERANCE = 5
/** 拼图答案 x 的取值范围：太靠左拖一下就中，太靠右拖不到头 */
const X_MIN = PIECE_WIDTH
const X_MAX = BG_WIDTH - PIECE_WIDTH
/** 挑战数据 Redis key 前缀（存答案 x），TTL 5 分钟一次性 */
const CHALLENGE_PREFIX = 'captcha:'
/** 滑块验证通过 ticket 的 Redis key 前缀，TTL 2 分钟一次性 */
const TICKET_PREFIX = 'captcha-pass:'

interface ChallengeData {
  x: number
}

/** 柔和随机色（HSL 转 RGB），用于程序化生成背景渐变 */
function pastel(): { r: number; g: number; b: number } {
  const h = Math.random() * 360
  const s = 0.3 + Math.random() * 0.25
  const l = 0.62 + Math.random() * 0.2
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = h / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const [r1, g1, b1] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x]
  const m = l - c / 2
  return { r: Math.round((r1 + m) * 255), g: Math.round((g1 + m) * 255), b: Math.round((b1 + m) * 255) }
}

/**
 * 滑块验证码服务（防爆破）
 *
 * 流程：create() 下发「带缺口的背景图 + 拼图条」（dataURL）与 captchaId，答案 x 存 Redis；
 * 用户拖拽后 verify(challengeId, x) 校验位移（容差 ±5px），通过后发放一次性 ticket；
 * 登录时 assertTicket(ticket) 原子消费。challenge 与 ticket 都是一次性（MULTI GET+DEL），
 * 只走 Redis（EX 自动过期），支持多实例部署；未启用 Redis 或故障时直接抛业务错误，不做内存降级。
 *
 * 图片用 jimp 程序化生成（渐变 + 随机圆形纹理），不依赖外部图片资源；
 * jimp 锁 0.22（纯 JS、CJS 兼容；1.x 起转 ESM，与本项目 CJS 构建冲突）。
 */
@Injectable()
export class CaptchaService {
  /** 挑战有效期 5 分钟 */
  private readonly challengeTtl = 300
  /** ticket 有效期 2 分钟（验证完应立即登录） */
  private readonly ticketTtl = 120

  constructor(private readonly redisService: RedisService) {}

  /** 生成滑块挑战：返回背景图/拼图条（PNG dataURL）与 captchaId */
  async create(): Promise<{ captchaId: string; bgUrl: string; puzzleUrl: string }> {
    const client = this.requireClient()
    const bg = this.generateBackground()
    const x = X_MIN + Math.floor(Math.random() * (X_MAX - X_MIN + 1))

    // 拼图条：从原背景上切下通高竖条
    const puzzle = bg.clone().crop(x, 0, PIECE_WIDTH, BG_HEIGHT)
    // 背景挖缺口：同区域压暗并描边，视觉上形成「待填补的缺口」
    this.darkenRegion(bg, x, 0, PIECE_WIDTH, BG_HEIGHT)

    const [bgUrl, puzzleUrl] = await Promise.all([bg.getBase64Async(Jimp.MIME_PNG), puzzle.getBase64Async(Jimp.MIME_PNG)])
    const captchaId = randomUUID()
    await client.set(CHALLENGE_PREFIX + captchaId, JSON.stringify({ x } satisfies ChallengeData), 'EX', this.challengeTtl)
    return { captchaId, bgUrl, puzzleUrl }
  }

  /**
   * 校验拖动位置并发放 ticket（一次性）：
   * challenge 先 GET+DEL（并发重放只有首个请求能命中），误差超过容差直接拒绝（刷新重来）；
   * 通过后发 ticket（新 UUID，EX 120s），登录时消费。
   */
  async verify(captchaId?: string, x?: number): Promise<{ ticket: string }> {
    if (!captchaId || typeof x !== 'number' || !Number.isFinite(x)) {
      throw new BizException(BizErrorCode.CAPTCHA_PARAM_INVALID, '请完成滑块验证')
    }
    const client = this.requireClient()
    const results = (await client
      .multi()
      .get(CHALLENGE_PREFIX + captchaId)
      .del(CHALLENGE_PREFIX + captchaId)
      .exec()) as Array<[null, string | number | null]>
    const [, raw] = results[0]

    if (typeof raw !== 'string') {
      throw new BizException(BizErrorCode.CAPTCHA_EXPIRED, '验证码已过期，请刷新重试')
    }
    const answer = (JSON.parse(raw) as ChallengeData).x
    if (Math.abs(x - answer) > TOLERANCE) {
      throw new BizException(BizErrorCode.CAPTCHA_INVALID, '滑块位置不正确，请重试')
    }
    const ticket = randomUUID()
    await client.set(TICKET_PREFIX + ticket, '1', 'EX', this.ticketTtl)
    return { ticket }
  }

  /** 登录前校验并消费 ticket（一次性）：没用过 → 通过并删除；不存在 → 已过期/未验证 */
  async assertTicket(ticket?: string): Promise<void> {
    if (!ticket) {
      throw new BizException(BizErrorCode.CAPTCHA_PARAM_INVALID, '请先完成滑块验证')
    }
    const client = this.requireClient()
    const results = (await client
      .multi()
      .get(TICKET_PREFIX + ticket)
      .del(TICKET_PREFIX + ticket)
      .exec()) as Array<[null, string | number | null]>
    if (typeof results[0][1] !== 'string') {
      throw new BizException(BizErrorCode.CAPTCHA_EXPIRED, '验证已失效，请重新完成滑块验证')
    }
  }

  /** 程序化生成背景：竖向渐变 + 随机半透明圆形纹理（无外部图片依赖） */
  private generateBackground(): Jimp {
    const from = pastel()
    const to = pastel()
    const bg = new Jimp(BG_WIDTH, BG_HEIGHT, 0xffffffff)
    bg.scan(0, 0, BG_WIDTH, BG_HEIGHT, function (this: Jimp, _x, y, idx) {
      const t = y / (BG_HEIGHT - 1)
      this.bitmap.data[idx] = Math.round(from.r + (to.r - from.r) * t)
      this.bitmap.data[idx + 1] = Math.round(from.g + (to.g - from.g) * t)
      this.bitmap.data[idx + 2] = Math.round(from.b + (to.b - from.b) * t)
      this.bitmap.data[idx + 3] = 255
    })
    // 随机圆形纹理：8 个半透明色块，让缺口位置无法靠「找纯色区域」猜测
    for (let i = 0; i < 8; i++) {
      this.drawCircle(bg, Math.random() * BG_WIDTH, Math.random() * BG_HEIGHT, 20 + Math.random() * 50, pastel(), 0.25 + Math.random() * 0.2)
    }
    return bg
  }

  /** 在图上画实心圆（带透明度） */
  private drawCircle(img: Jimp, cx: number, cy: number, r: number, color: { r: number; g: number; b: number }, alpha: number): void {
    const x0 = Math.max(0, Math.floor(cx - r))
    const y0 = Math.max(0, Math.floor(cy - r))
    const w = Math.min(img.bitmap.width - x0, Math.ceil(r * 2) + 1)
    const h = Math.min(img.bitmap.height - y0, Math.ceil(r * 2) + 1)
    if (w <= 0 || h <= 0) return
    img.scan(x0, y0, w, h, function (this: Jimp, x, y, idx) {
      const dx = x - cx
      const dy = y - cy
      if (dx * dx + dy * dy > r * r) return
      const d = this.bitmap.data
      d[idx] = Math.round(d[idx] * (1 - alpha) + color.r * alpha)
      d[idx + 1] = Math.round(d[idx + 1] * (1 - alpha) + color.g * alpha)
      d[idx + 2] = Math.round(d[idx + 2] * (1 - alpha) + color.b * alpha)
    })
  }

  /** 把矩形区域压暗（挖缺口），并在边缘描一圈更深的线增强「凹槽」观感 */
  private darkenRegion(img: Jimp, x0: number, y0: number, w: number, h: number): void {
    img.scan(x0, y0, w, h, function (this: Jimp, x, y, idx) {
      const d = this.bitmap.data
      const edge = x === x0 || x === x0 + w - 1
      const f = edge ? 0.35 : 0.55
      d[idx] = Math.round(d[idx] * f)
      d[idx + 1] = Math.round(d[idx + 1] * f)
      d[idx + 2] = Math.round(d[idx + 2] * f)
    })
  }

  /** 未启用 Redis 时统一抛业务错误（HTTP 200 + code 503），由前端统一拦截提示 */
  private requireClient() {
    const client = this.redisService.client
    if (!client) {
      throw new BizException(BizErrorCode.SERVICE_UNAVAILABLE, '验证码服务不可用，请检查 Redis 配置（REDIS_ENABLED）')
    }
    return client
  }
}
