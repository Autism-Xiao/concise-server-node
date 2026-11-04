import { IP2Region } from 'ip2region/node'
import { UAParser } from 'ua-parser-js'

/**
 * 请求信息解析：从 ip + User-Agent 两个「原料」派生出日志展示字段
 * - browser：Chrome 156 / Edge 140 / Firefox 132 / Safari 18 …
 * - os：Windows 10 / macOS 15 / Android 14 …
 * - location：本机 / 内网IP / 广东省 深圳市 电信（ip2region 离线库，不依赖外网）
 *
 * 解析失败一律返回「未知」，日志增强永远不能影响登录主流程。
 */

/** ip2region 单例：应用生命周期内复用（同步构造只读 IPv4 库，约 11MB，首次调用时加载） */
let ipQuery: IP2Region | null = null
let ipQueryFailed = false

function getIpQuery(): IP2Region | null {
  if (ipQuery || ipQueryFailed) {
    return ipQuery
  }
  try {
    ipQuery = new IP2Region({ families: [4] })
  } catch (error) {
    // 库文件缺失/损坏时降级为「未知」，只记录一次
    ipQueryFailed = true
    console.error('[request-info] ip2region 初始化失败，归属地降级为未知:', error)
  }
  return ipQuery
}

/** 判断是否本机/内网地址（IPv4 + IPv6 常见形态） */
function isLocalOrPrivateIp(ip: string): 'local' | 'private' | null {
  const value = ip.trim()
  if (!value) return null
  if (value === '127.0.0.1' || value === '::1' || value === 'localhost' || value === '::ffff:127.0.0.1') {
    return 'local'
  }
  if (/^(10\.|192\.168\.|169\.254\.|fe80:|fc00:|fd)/i.test(value)) {
    return 'private'
  }
  // 172.16.0.0 ~ 172.31.255.255
  const m = /^172\.(\d+)\./.exec(value)
  if (m) {
    const second = Number(m[1])
    if (second >= 16 && second <= 31) return 'private'
  }
  return null
}

/** 浏览器：UAParser 主版本，如 "Chrome 156" */
export function parseBrowser(userAgent?: string | null): string {
  if (!userAgent) return '未知浏览器'
  try {
    const { browser } = UAParser(userAgent)
    if (!browser.name) return '未知浏览器'
    const major = (browser.version ?? '').split('.')[0]
    return major ? `${browser.name} ${major}` : browser.name
  } catch {
    return '未知浏览器'
  }
}

/** 操作系统：主版本，如 "Windows 10" / "macOS 15" */
export function parseOs(userAgent?: string | null): string {
  if (!userAgent) return '未知系统'
  try {
    const { os } = UAParser(userAgent)
    if (!os.name) return '未知系统'
    const major = (os.version ?? '').split('.')[0]
    return major ? `${os.name} ${major}` : os.name
  } catch {
    return '未知系统'
  }
}

/** IP 归属地：本机/内网直接判定，公网走 ip2region 离线库 */
export function describeIp(ip?: string | null): string {
  if (!ip) return '未知'
  const kind = isLocalOrPrivateIp(ip)
  if (kind === 'local') return '本机'
  if (kind === 'private') return '内网IP'
  const query = getIpQuery()
  if (!query) return '未知'
  try {
    // trust proxy 场景 X-Forwarded-For 可能带端口或 ::ffff: 前缀，先清洗
    const clean = ip
      .replace(/^::ffff:/, '')
      .split(/[%:]/)[0]
      .trim()
    const result = query.lookup(clean)
    if (!result) return '未知'
    const parts = [result.country?.name, result.subdivisions?.[0]?.name, result.city?.name, result.isp].filter(Boolean)
    return parts.length ? parts.join(' ') : '未知'
  } catch {
    return '未知'
  }
}

/** 一次解析出日志三件套 */
export function parseRequestInfo(ip?: string | null, userAgent?: string | null): { browser: string; os: string; location: string } {
  return { browser: parseBrowser(userAgent), os: parseOs(userAgent), location: describeIp(ip) }
}
