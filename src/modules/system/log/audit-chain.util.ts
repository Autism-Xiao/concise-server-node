import { createHash } from 'node:crypto'

/**
 * 审计哈希链纯函数（单测锁定口径）
 *
 * 链结构：租户内按 seq 升序，entry = sha256(prev + canonical(row))。
 * 篡改任意一行 → 该行 entry_hash 与重算值不一致，且其后所有行的 prev 链接断裂。
 * 平台（tenant_id=0）与每个租户各自一条独立链，互不纠缠。
 */

export interface AuditChainRow {
  seq: number | string
  tenantId: number
  id: string
  /** log_type：0 登录 1 操作 */
  logType: number
  operateType: number | null
  operateUserId: string | null
  operateUserName: string | null
  ip: string
  status: number
  /** params / errorMsg 计入哈希（脱敏后的落库值，即审计可见值） */
  params: string | null
  errorMsg: string | null
  /** create_time 的毫秒时间戳（用 DB 返回值，别用应用时钟重算） */
  createTimeMs: number
}

/** 规范化串：字段固定顺序拼接，分隔符不参与歧义（值里可能出现竖线，用长度前缀防拼接歧义） */
export function buildCanonical(row: AuditChainRow): string {
  const parts = [
    String(row.seq),
    String(row.tenantId),
    row.id,
    String(row.logType),
    String(row.operateType ?? ''),
    row.operateUserId ?? '',
    row.operateUserName ?? '',
    row.ip,
    String(row.status),
    String(len(row.params)),
    row.params ?? '',
    String(len(row.errorMsg)),
    row.errorMsg ?? '',
    String(row.createTimeMs)
  ]
  return parts.join('\u0001')
}

function len(text: string | null): number {
  return (text ?? '').length
}

/** entry = sha256(prev + '\u0001' + canonical)；prev 为空串表示链起点 */
export function computeEntryHash(prevHash: string | null, row: AuditChainRow): string {
  return createHash('sha256')
    .update(`${prevHash ?? ''}\u0001${buildCanonical(row)}`)
    .digest('hex')
}
