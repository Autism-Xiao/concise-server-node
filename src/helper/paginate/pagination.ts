/**
 * 分页结果包装（records / total / size / current / pages 五字段）
 */
export class Pagination<T> {
  /** 当前页数据 */
  records: T[]
  /** 总条数；-1 = 本次未统计（skipCount 快路径，按 hasNext 翻页） */
  total: number
  /** 当前页码（从 1 开始） */
  current: number
  /** 每页条数 */
  size: number
  /** 总页数；total 为 -1 时同样返回 -1 */
  pages: number
  /** 是否还有下一页（仅在未统计总数时下发，其他情况由 pages 推出） */
  hasNext?: boolean

  constructor(records: T[], total: number, current: number, size: number, hasNext?: boolean) {
    this.records = records
    this.total = total
    this.current = current
    this.size = size
    this.pages = total < 0 ? -1 : Math.ceil(total / size)
    if (hasNext !== undefined) {
      this.hasNext = hasNext
    }
  }
}
