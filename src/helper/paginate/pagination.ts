/**
 * 分页结果包装（字段对齐 jeecg-boot / MyBatis-Plus IPage：records / total / size / current / pages）
 */
export class Pagination<T> {
  /** 当前页数据 */
  records: T[]
  /** 总条数 */
  total: number
  /** 当前页码（从 1 开始） */
  current: number
  /** 每页条数 */
  size: number
  /** 总页数 */
  pages: number

  constructor(records: T[], total: number, current: number, size: number) {
    this.records = records
    this.total = total
    this.current = current
    this.size = size
    this.pages = Math.ceil(total / size)
  }
}
