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
/** 干扰缺口数量范围：每次随机 1~2 个，位置与数量都随刷新变化，防「多刷几次排除法」 */
const DECOY_MIN = 1
const DECOY_MAX = 2
/** 缺口之间的最小水平间距：远大于容差 5px，拖到假坑必须明确失败，不能出现「感觉拖对了却说错」 */
const NOTCH_MIN_GAP = 50
/** 缺口包围盒尺寸（含凸起与余量）：两两不重叠用 */
const NOTCH_BOX_W = PIECE_WIDTH + 4
const NOTCH_BOX_H = PIECE_SIZE + KNOB_RADIUS + 4
/** 缺口深度的随机噪声幅度：真坑假坑都落在同一个噪声带里，「挑最暗的」这个策略失效 */
const NOTCH_DEPTH_NOISE = 0.08
/** 描边自适应的亮度过渡带：区域平均亮度 < 0.45 按深底（白描边），> 0.65 按浅底（黑描边），中间线性混合 */
const LUM_BAND_LOW = 0.45
const LUM_BAND_HIGH = 0.65
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

/**
 * 挑干扰缺口的位置：与已有缺口两两水平间距 ≥ NOTCH_MIN_GAP（假坑绝不能落在真坑 ±5px 容差带附近），
 * 且包围盒不重叠（水平不够就垂直错开）；每次随机 1~2 个，20 次尝试拿不满就少放一个，不硬挤。
 */
function pickDecoyPositions(realX: number, realY: number): Array<[number, number]> {
  const count = DECOY_MIN + Math.floor(Math.random() * (DECOY_MAX - DECOY_MIN + 1))
  const placed: Array<[number, number]> = [[realX, realY]]
  const decoys: Array<[number, number]> = []
  for (let i = 0; i < count; i++) {
    for (let tries = 0; tries < 20; tries++) {
      const dx = X_MIN + Math.floor(Math.random() * (X_MAX - X_MIN + 1))
      const dy = Y_MIN + Math.floor(Math.random() * (Y_MAX - Y_MIN + 1))
      const clear = placed.every(([px, py]) => {
        const gapX = Math.abs(px - dx)
        // 水平间距必须无条件 ≥ 50px：假坑绝不能落进真坑 ±5px 容差带附近，
        // 否则「对准假坑」和「对准真坑」在校验上等价，视觉与判定会打架
        if (gapX < NOTCH_MIN_GAP) return false
        // 包围盒还不重叠：水平够宽就行，不够就垂直错开
        return gapX >= NOTCH_BOX_W || Math.abs(py - dy) >= NOTCH_BOX_H
      })
      if (clear) {
        placed.push([dx, dy])
        decoys.push([dx, dy])
        break
      }
    }
  }
  return decoys
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
 * 图片用 jimp 程序化生成（同色系渐变背景 + 真假缺口 + 描边随背景亮度自适应），不依赖外部图片资源；
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
    // 真坑与假坑都带随机深度噪声（同一噪声带），「挑最暗的那个」的排除策略失效
    this.carveNotch(bg, x, y, Math.random() * NOTCH_DEPTH_NOISE)
    for (const [dx, dy] of pickDecoyPositions(x, y)) {
      this.carveNotch(bg, dx, dy, Math.random() * NOTCH_DEPTH_NOISE)
    }

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

  /** 背景挖拼图缺口：形状内压暗，边缘再压深一档形成凹槽侧壁；覆盖率参与混合，轮廓平滑无锯齿。
   * depthNoise 是本次缺口的整体加深量（真坑假坑共用同一随机带），让「挑最暗」的排除法失效 */
  private carveNotch(bg: Jimp, x: number, y: number, depthNoise = 0): void {
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
      // 凹槽深度：整体压暗，顶部略深、底部略亮（模拟光从上方来），边缘再压一档形成侧壁；
      // depthNoise 让同一张图上的真坑假坑深浅落在同一随机带里
      const vertical = (ly + KNOB_RADIUS) / (PIECE_SIZE + KNOB_RADIUS)
      const base = 0.5 - 0.08 * (1 - vertical) - depthNoise
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
   * - 块体：深底略提亮 / 浅底略压暗，靠柔和的明暗差与背景分离
   * - **没有描边**：白描边是「白框」（2026-11-10 第一轮反馈），自适应黑描边又成了「黑框」（第二轮反馈），
   *   任何 1px 实线在滑块这种尺寸下都显得生硬。轮廓完全交给覆盖率的半透明边缘（4×4 超采样，天然抗锯齿），
   *   存在感由块体明暗差 + 投影提供
   * - 形状外右下侧 1px 淡阴影：给块一点厚度感
   */
  private buildPiece(bg: Jimp, x: number, y: number): Jimp {
    // 先量拼图块区域的平均亮度（隔行采样足够），决定块体的明暗方向
    let lumSum = 0
    let lumN = 0
    for (let sy = Math.max(0, y - KNOB_RADIUS); sy < Math.min(BG_HEIGHT, y + PIECE_SIZE); sy += 2) {
      for (let sx = Math.max(0, x); sx < Math.min(BG_WIDTH, x + PIECE_SIZE); sx += 2) {
        const c = bg.getPixelColor(sx, sy)
        lumSum += (0.2126 * ((c >>> 24) & 0xff) + 0.7152 * ((c >>> 16) & 0xff) + 0.0722 * ((c >>> 8) & 0xff)) / 255
        lumN++
      }
    }
    const lum = lumN > 0 ? lumSum / lumN : 0.5
    // 0 = 深底（块体提亮）→ 1 = 浅底（块体压暗），过渡带内线性混合
    const lightness = Math.min(1, Math.max(0, (lum - LUM_BAND_LOW) / (LUM_BAND_HIGH - LUM_BAND_LOW)))

    const puzzle = new Jimp(PIECE_WIDTH, BG_HEIGHT, 0x00000000)
    for (let ly = -KNOB_RADIUS - 1; ly < PIECE_SIZE + 1; ly++) {
      for (let lx = 0; lx < PIECE_WIDTH; lx++) {
        const sy = y + ly
        const sx = x + lx
        if (sx < 0 || sx >= BG_WIDTH || sy < 0 || sy >= BG_HEIGHT) continue
        const cov = pieceCoverage(lx, ly)
        if (cov <= 0) {
          // 形状外：紧贴形状的两圈渐变阴影（19% → 9%），柔和不显脏，块才有「浮起」的厚度
          if (pieceCoverage(lx - 1, ly - 1) > 0.5) puzzle.setPixelColor(0x00000030, lx, sy)
          else if (pieceCoverage(lx - 2, ly - 2) > 0.5) puzzle.setPixelColor(0x00000017, lx, sy)
          continue
        }
        const base = bg.getPixelColor(sx, sy)
        const r = (base >>> 24) & 0xff
        const g = (base >>> 16) & 0xff
        const b = (base >>> 8) & 0xff
        // 块体：深底 +8% 白（玻璃感），浅底 -18%（明显略暗于背景，但仍是同色系，不出现边线）
        const fr = Math.round((r * 0.92 + 255 * 0.08) * (1 - lightness) + r * 0.82 * lightness)
        const fg = Math.round((g * 0.92 + 255 * 0.08) * (1 - lightness) + g * 0.82 * lightness)
        const fb = Math.round((b * 0.92 + 255 * 0.08) * (1 - lightness) + b * 0.82 * lightness)
        // alpha 用覆盖率，边缘因此是渐隐的，不是硬切
        puzzle.setPixelColor(((fr << 24) | (fg << 16) | (fb << 8) | Math.round(cov * 255)) >>> 0, lx, sy)
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
