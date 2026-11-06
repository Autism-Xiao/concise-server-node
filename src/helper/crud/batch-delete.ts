import { BadRequestException } from '@nestjs/common'

/**
 * 批量删除公共协议
 *
 * 为什么不让前端 Promise.all 循环单删：
 * - N 条 id 就是 N 次 HTTP + N 次 SQL，200 条能拖到十几秒
 * - 没有事务边界，删到一半失败会留下「删了一半」的中间状态
 * - 每次单删都会写一条操作日志，批量操作把日志表刷成流水账
 * - 失败原因散落在 N 个响应里，前端只能拼一句「N 个失败」，说不出为什么
 *
 * 所以统一成「一次请求 + 逐条结算」：删除动作仍然逐条执行（保住各自的业务保护规则，
 * 比如部门有子部门不能删、角色下有人不能删），但失败原因会被收集回来。
 */

/** 单次批量删除上限：够用又能保证响应时间可控 */
export const BATCH_DELETE_MAX = 200

/** 单条失败明细：id 必填，name 用于前端直接展示「XX 删除失败：原因」 */
export interface BatchDeleteFailure {
  id: string
  name?: string
  reason: string
}

/** 批量删除结果：deleted 为成功条数，failed 为空即全部成功 */
export interface BatchDeleteResult {
  deleted: number
  failed: BatchDeleteFailure[]
}

/** 去掉重复 id 并做基础校验（空数组/超上限直接 400） */
export function normalizeBatchIds(ids: string[]): string[] {
  const unique = [...new Set(ids.map(id => String(id ?? '').trim()).filter(Boolean))]
  if (!unique.length) {
    throw new BadRequestException('请选择要操作的数据')
  }
  if (unique.length > BATCH_DELETE_MAX) {
    throw new BadRequestException(`单次最多操作 ${BATCH_DELETE_MAX} 条，当前 ${unique.length} 条，请分批操作`)
  }
  return unique
}

/**
 * 逐条执行删除并收集失败原因
 *
 * - 单条失败不中断，继续处理后面的（用户勾了 50 条，不该因为第 1 条不可删就全放弃）
 * - 异常信息优先取 Error.message，NestJS 的 BadRequestException 也走这条，能拿到中文提示
 * - requestedIds：前端提交的完整 id 列表。传了它，库里查不到的 id（已被别人删掉 / 传错）会
 *   以「记录不存在或已被删除」进 failed，而不是被静默忽略 —— 否则前端只会看到
 *   「选了 3 条，deleted=2」却没有任何解释。
 */
export async function runBatchDelete<T>(
  targets: T[],
  handlers: {
    getId: (item: T) => string
    getName?: (item: T) => string | undefined
    remove: (item: T) => Promise<unknown>
  },
  requestedIds?: string[]
): Promise<BatchDeleteResult> {
  const result: BatchDeleteResult = { deleted: 0, failed: [] }
  const handled = new Set<string>()
  for (const target of targets) {
    const id = handlers.getId(target)
    handled.add(id)
    try {
      await handlers.remove(target)
      result.deleted += 1
    } catch (error) {
      const reason = error instanceof Error && error.message ? error.message : '删除失败'
      result.failed.push({ id, name: handlers.getName?.(target), reason })
    }
  }
  if (requestedIds) {
    for (const id of new Set(requestedIds.map(raw => String(raw ?? '').trim()).filter(Boolean))) {
      if (!handled.has(id)) {
        result.failed.push({ id, reason: '记录不存在或已被删除' })
      }
    }
  }
  return result
}
