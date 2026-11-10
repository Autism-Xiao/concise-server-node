import { Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import Jimp from 'jimp'

import { BizErrorCode } from '../../../common/enums/biz-error-code.enum'
import { BizException } from '../../../common/exceptions/biz.exception'
import { RedisService } from '../../../shared/redis/redis.service'

/** 背景图尺寸（与前端 rc-slider-captcha 默认 bgSize 320x160 保持一致，避免缩放导致 x 误差） */
const BG_WIDTH = 320
const BG_HEIGHT = 160
/** 拼图透明底图宽度（= 方块边长 + 凸起半径，与组件默认 puzzleSize.width 一致，1:1 显示不缩放） */
const PIECE_WIDTH = 60
/** 拼图方块边长与凸起半径：经典拼图形状 = 方块 + 顶部圆形凸起 + 右侧圆形凹槽 */
const PIECE_SIZE = 50
const KNOB_RADIUS = 10
/** 校验容差（像素）：拖动落点与答案的偏差范围内视为通过 */
const TOLERANCE = 5
/**
 * 拼图答案 x 的取值范围
 * - 左界必须大于拼图块的初始显示宽度（PIECE_WIDTH=60），否则初始位置就和缺口重叠，
 *   画面上会同时出现「凹槽」和「拼图块」两个深色形状叠在一起，看着像重影
 * - 右界预留 10px，避免缺口贴边
 */
const X_MIN = PIECE_WIDTH + 50
const X_MAX = BG_WIDTH - PIECE_WIDTH - 10
/** 拼图 y 的取值范围：上下各留 20px，保证凸起不越界 */
const Y_MIN = 20
const Y_MAX = BG_HEIGHT - PIECE_SIZE - Y_MIN
/** 挑战数据 Redis key 前缀（存答案 x），TTL 5 分钟一次性 */
const CHALLENGE_PREFIX = 'captcha:'
/** 滑块验证通过 ticket 的 Redis key 前缀，TTL 2 分钟一次性 */
const TICKET_PREFIX = 'captcha-pass:'

interface ChallengeData {
  x: number
}

/**
 * 判断拼图局部坐标是否在拼图形状内
 * - 形状：PIECE_SIZE 方块 + 顶部圆形凸起（圆心在方块上边中点）+ 右侧圆形凹槽（圆心在方块右边中点，挖除）
 * - lx 相对拼块左缘（0..PIECE_WIDTH），ly 相对方块顶边（可为负，凸起伸到 -KNOB_RADIUS）
 */
function insidePiece(lx: number, ly: number): boolean {
  const inRect = lx >= 0 && lx < PIECE_SIZE && ly >= 0 && ly < PIECE_SIZE
  const topKnob = ly >= -KNOB_RADIUS && ly < 0 && Math.hypot(lx - PIECE_SIZE / 2, ly) <= KNOB_RADIUS
  const rightSlot = lx >= PIECE_SIZE - KNOB_RADIUS && lx < PIECE_WIDTH && ly >= 0 && Math.hypot(lx - PIECE_SIZE, ly - PIECE_SIZE / 2) <= KNOB_RADIUS
  return (inRect || topKnob) && !rightSlot
}

/**
 * 形状覆盖率（4x4 超采样）
 * 逐像素硬判定 insidePiece 会在凸起和凹槽的弧线上留下明显台阶，放大后很毛糙；
 * 这里按像素面积求覆盖率（0..1），用作 alpha / 混合系数，边缘就平滑了。
 */
function pieceCoverage(lx: number, ly: number): number {
  const N = 4
  let hit = 0
  for (let sy = 0; sy < N; sy++) {
    const py = ly - 0.5 + (sy + 0.5) / N
    for (let sx = 0; sx < N; sx++) {
      const px = lx - 0.5 + (sx + 0.5) / N
      if (insidePiece(px, py)) hit++
    }
  }
  return hit / (N * N)
}

/** 局部坐标是否落在形状边界上（四邻域有形状外的点），用于描边 */
function onPieceEdge(lx: number, ly: number): boolean {
  return !insidePiece(lx - 1, ly) || !insidePiece(lx + 1, ly) || !insidePiece(lx, ly - 1) || !insidePiece(lx, ly + 1)
}

/** HSL 转 RGB：同一色系出图，避免随机撞色（粉+绿）导致画面很脏 */
function hsl(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hue = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = hue / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const [r1, g1, b1] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x]
  const m = l - c / 2
  return { r: Math.round((r1 + m) * 255), g: Math.round((g1 + m) * 255), b: Math.round((b1 + m) * 255) }
}

/**
 * 滑块验证码服务（防爆破）
 *
 * 流程：create() 下发「带拼图缺口的背景图 + 拼图块」（dataURL）与 captchaId，答案 x 存 Redis；
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

  /** 生成滑块挑战：返回背景图/拼图块（PNG dataURL）与 captchaId */
  async create(): Promise<{ captchaId: string; bgUrl: string; puzzleUrl: string }> {
    const client = this.requireClient()
    const bg = this.generateBackground()
    const x = X_MIN + Math.floor(Math.random() * (X_MAX - X_MIN + 1))
    const y = Y_MIN + Math.floor(Math.random() * (Y_MAX - Y_MIN + 1))

    // 顺序很重要：先从干净背景抠出拼图块（原色、明亮），再挖缺口（压暗的凹槽）。
    // 反过来的话拼图块会取到被压暗的像素，块和坑一样暗，既显脏也分不清有没有对上。
    const puzzle = this.buildPiece(bg, x, y)
    this.carveNotch(bg, x, y)

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

  /**
   * 程序化生成背景：同色系斜向渐变 + 柔和暗角
   *
   * 之前叠过随机圆形色块做「干扰纹理」，结果画面上到处是圆弧边，既显脏又抢注意力，
   * 缺口反而不好找。改成连续渐变（没有可辨识的图形边界）后画面干净，
   * 缺口是画面上唯一有明确形状的区域，一眼就能定位。
   */
  private generateBackground(): Jimp {
    const hue = Math.random() * 360
    const from = hsl(hue, 0.34 + Math.random() * 0.12, 0.79)
    const to = hsl(hue + 18 + Math.random() * 28, 0.4 + Math.random() * 0.12, 0.62)
    const bg = new Jimp(BG_WIDTH, BG_HEIGHT, 0xffffffff)
    const cx = BG_WIDTH / 2
    const cy = BG_HEIGHT * 0.4
    const maxD = Math.hypot(BG_WIDTH / 2, BG_HEIGHT / 2)
    bg.scan(0, 0, BG_WIDTH, BG_HEIGHT, function (this: Jimp, x, y, idx) {
      // 斜向过渡（下-右为主），避免纯竖向渐变把画面切成上下两块
      const u = Math.min(1, (y / (BG_HEIGHT - 1)) * 0.8 + (x / (BG_WIDTH - 1)) * 0.2)
      // 暗角：距离中心越远越暗，平方曲线保证边缘过渡没有可见边界
      const d = Math.hypot(x - cx, y - cy) / maxD
      const k = 1 - 0.15 * d * d
      this.bitmap.data[idx] = Math.round((from.r + (to.r - from.r) * u) * k)
      this.bitmap.data[idx + 1] = Math.round((from.g + (to.g - from.g) * u) * k)
      this.bitmap.data[idx + 2] = Math.round((from.b + (to.b - from.b) * u) * k)
      this.bitmap.data[idx + 3] = 255
    })
    return bg
  }

  /** 背景挖拼图缺口：形状内压暗，边缘再压深一档形成凹槽侧壁；覆盖率参与混合，轮廓平滑无锯齿 */
  private carveNotch(bg: Jimp, x: number, y: number): void {
    const x0 = Math.max(0, x - 1)
    const y0 = Math.max(0, y - KNOB_RADIUS - 1)
    const x1 = Math.min(BG_WIDTH, x + PIECE_WIDTH + 1)
    const y1 = Math.min(BG_HEIGHT, y + PIECE_SIZE + KNOB_RADIUS + 1)
    const w = x1 - x0
    const h = y1 - y0
    if (w <= 0 || h <= 0) return
    bg.scan(x0, y0, w, h, function (this: Jimp, gx, gy, idx) {
      const lx = gx - x
      const ly = gy - y
      const cov = pieceCoverage(lx, ly)
      if (cov <= 0) return
      // 凹槽深度：整体压暗，顶部略深、底部略亮（模拟光从上方来），边缘再压一档形成侧壁
      const vertical = (ly + KNOB_RADIUS) / (PIECE_SIZE + KNOB_RADIUS)
      const base = 0.5 - 0.08 * (1 - vertical)
      const target = onPieceEdge(lx, ly) ? base - 0.2 : base
      const k = 1 - (1 - target) * cov
      const d = this.bitmap.data
      d[idx] = Math.round(d[idx] * k)
      d[idx + 1] = Math.round(d[idx + 1] * k)
      d[idx + 2] = Math.round(d[idx + 2] * k)
    })
  }

  /**
   * 生成拼图块透明底图（必须在 carveNotch 之前调用，这样才能取到未被压暗的原色）
   * - 块体：背景原色略提亮，看起来是「浮在画面上的块」
   * - 描边：1px 半透明白，既能和背景分离又不刺眼
   * - 右下 1px 阴影：给块一点厚度感
   */
  private buildPiece(bg: Jimp, x: number, y: number): Jimp {
    const puzzle = new Jimp(PIECE_WIDTH, BG_HEIGHT, 0x00000000)
    for (let ly = -KNOB_RADIUS - 1; ly < PIECE_SIZE + 1; ly++) {
      for (let lx = 0; lx < PIECE_WIDTH; lx++) {
        const sy = y + ly
        const sx = x + lx
        if (sx < 0 || sx >= BG_WIDTH || sy < 0 || sy >= BG_HEIGHT) continue
        const cov = pieceCoverage(lx, ly)
        if (cov <= 0) {
          // 形状外：紧贴形状的左上侧压一圈淡阴影，块才有厚度
          if (pieceCoverage(lx - 1, ly - 1) > 0.5) puzzle.setPixelColor(0x0000003a, lx, sy)
          continue
        }
        const base = bg.getPixelColor(sx, sy)
        let r = (base >>> 24) & 0xff
        let g = (base >>> 16) & 0xff
        let b = (base >>> 8) & 0xff
        if (onPieceEdge(lx, ly)) {
          // 白色描边（88%）：轮廓清楚，但不至于在深色画面上变成一圈刺眼的白线
          r = Math.round(r * 0.12 + 255 * 0.88)
          g = Math.round(g * 0.12 + 255 * 0.88)
          b = Math.round(b * 0.12 + 255 * 0.88)
        } else {
          // 原色叠一点点白：像一块从画面上浮起的实体，同时保留背景纹理
          r = Math.round(r * 0.92 + 255 * 0.08)
          g = Math.round(g * 0.92 + 255 * 0.08)
          b = Math.round(b * 0.92 + 255 * 0.08)
        }
        // alpha 用覆盖率，边缘因此是渐隐的，不是硬切
        puzzle.setPixelColor(((r << 24) | (g << 16) | (b << 8) | Math.round(cov * 255)) >>> 0, lx, sy)
      }
    }
    return puzzle
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
