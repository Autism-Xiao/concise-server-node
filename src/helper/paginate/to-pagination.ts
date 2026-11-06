import { Pagination } from './pagination'

/**
 * 把「已经取到内存里的数组」包装成统一的分页结构
 *
 * 为什么需要它：项目里列表接口一度有两种返回形态 ——
 *  users / notices / jobs / logs 返回 { records, total, ... }，
 *  roles / depts / levels / posts / dicts / menus 直接返回数组。
 * 前端每接一个页面都要先确认是哪一种，鉴权/导出/冒烟脚本也各写一套判断。
 *
 * 现在统一为 Pagination（records / total / current / size / pages）：
 *  - 数据量小、本来就不需要服务端分页的字典类数据（角色/部门/职级/岗位/字典/菜单），
 *    统一用 size = total、pages = 1 表示「一次全量返回」；
 *  - 真需要分页时，调用方自己切片后传入 page/pageSize 即可，结构不变。
 *
 * 传 pageSize 时会做内存切片，且 page 从 1 开始（越界返回空数组，不报错）。
 */
export function toPagination<T>(records: T[], page = 1, pageSize?: number): Pagination<T> {
  const total = records.length
  const current = Math.max(Math.trunc(page) || 1, 1)

  // 未指定 pageSize（或非正数）= 不分页，一次全量返回
  if (!pageSize || pageSize <= 0) {
    return new Pagination(records, total, 1, total || 1)
  }

  const size = Math.trunc(pageSize)
  const start = (current - 1) * size
  return new Pagination(records.slice(start, start + size), total, current, size)
}
