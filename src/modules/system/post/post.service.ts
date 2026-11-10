import { BadRequestException, HttpStatus, Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Brackets, In, Repository } from 'typeorm'

import { BizErrorCode } from '../../../common/enums/biz-error-code.enum'
import { BizException } from '../../../common/exceptions/biz.exception'
import { BaseService } from '../../../helper/crud/base.service'
import { applyTenantScope } from '../../../shared/tenant/tenant-scope.util'
import { normalizeBatchIds, runBatchDelete, type BatchDeleteResult } from '../../../helper/crud/batch-delete'
import {
  assertImportRows,
  createImportResult,
  failImportRow,
  parsePositiveInt,
  parseSwitchText,
  pickCell,
  resolveImportLayout,
  type ImportResult
} from '../../../helper/import/excel-import'
import { DeptEntity } from '../dept/entities/dept.entity'
import { PostEntity } from './entities/post.entity'
import type { CreatePostDto } from './dto/create-post.dto'
import type { QueryPostDto } from './dto/query-post.dto'
import type { UpdatePostDto } from './dto/update-post.dto'

/** 导出上限：岗位随组织规模增长，兜住异常膨胀 */
export const POST_EXPORT_MAX_ROWS = 5000

/** 导入列别名 */
type PostImportField = 'postCode' | 'postName' | 'postSort' | 'deptName' | 'status' | 'description'

const POST_IMPORT_ALIASES: Record<PostImportField, string[]> = {
  postCode: ['岗位编码', '编码', 'postcode'],
  postName: ['岗位名称', '名称', '岗位', 'postname'],
  postSort: ['排序', '岗位排序', 'postsort'],
  deptName: ['所属部门', '部门', 'deptname', 'dept'],
  status: ['状态', 'status'],
  description: ['描述', '备注', '说明', 'description']
}

@Injectable()
export class PostService extends BaseService<PostEntity> {
  constructor(
    @InjectRepository(PostEntity)
    private readonly postRepository: Repository<PostEntity>
  ) {
    super(postRepository, '岗位')
  }

  /** 岗位列表（post_sort 升序，带所属部门），keyword 模糊匹配名称/编码/描述，可按 deptId 过滤 */
  async listByQuery(query: QueryPostDto): Promise<PostEntity[]> {
    const qb = this.postRepository.createQueryBuilder('post').leftJoinAndSelect('post.dept', 'dept').orderBy('post.post_sort', 'ASC')
    applyTenantScope(qb, 'post')
    const keyword = query.keyword?.trim()
    if (keyword) {
      const kw = `%${keyword}%`
      // andWhere 而不是 where：避免把上面的租户条件覆盖掉
      qb.andWhere(
        new Brackets(sub =>
          sub.where('post.post_name LIKE :kw', { kw }).orWhere('post.post_code LIKE :kw', { kw }).orWhere('post.description LIKE :kw', { kw })
        )
      )
    }
    if (query.deptId) {
      qb.andWhere('post.dept_id = :deptId', { deptId: query.deptId })
    }
    return qb.getMany()
  }

  /** 创建岗位：postCode 唯一（前置拦截可读报错）；deptId 传了必须存在 */
  async createPost(dto: CreatePostDto, operator?: string): Promise<PostEntity> {
    await this.assertCodeAvailable(dto.postCode)
    if (dto.deptId) {
      await this.assertDeptExists(dto.deptId)
    }
    return this.create({
      ...dto,
      createBy: operator,
      createTime: new Date()
    })
  }

  /** 更新岗位：改编码时校验唯一、换部门时校验部门存在 */
  async updatePost(id: string, dto: UpdatePostDto, operator?: string): Promise<PostEntity> {
    const before = await this.findOne(id)
    if (dto.postCode && dto.postCode !== before.postCode) {
      await this.assertCodeAvailable(dto.postCode)
    }
    if (dto.deptId) {
      await this.assertDeptExists(dto.deptId)
    }
    return this.update(id, { ...dto, updateBy: operator, updateTime: new Date() })
  }

  private async assertCodeAvailable(postCode: string): Promise<void> {
    const exists = await this.postRepository.findOne({ where: { postCode } })
    if (exists) {
      throw new BadRequestException(`岗位编码「${postCode}」已存在`)
    }
  }

  private async assertDeptExists(deptId: string): Promise<void> {
    const dept = await this.postRepository.manager.findOne(DeptEntity, { where: { id: deptId, delFlag: '0' } })
    if (!dept) {
      throw new BadRequestException('所属部门不存在或已删除')
    }
  }

  /** 导出：与列表同筛选条件（keyword / deptId），超出上限截断 */
  async exportPosts(query: QueryPostDto): Promise<PostEntity[]> {
    const list = await this.listByQuery(query)
    return list.slice(0, POST_EXPORT_MAX_ROWS)
  }

  /**
   * 导入岗位（xlsx 解析后的二维数组，第一行为表头）
   * - 按「岗位编码」判定：不存在新增，已存在更新（只更新填了值的列）
   * - 所属部门按名称匹配；写了但找不到直接判该行失败，避免「导入成功但部门丢了」
   */
  async importPosts(rows: string[][], headerRowNumber = 1, operator?: string): Promise<ImportResult> {
    if (!rows.length) {
      throw new BizException(BizErrorCode.IMPORT_EMPTY, '文件内容为空，请下载模板后填写', HttpStatus.BAD_REQUEST)
    }
    const { columns, dataRows } = resolveImportLayout<PostImportField>(rows, headerRowNumber, POST_IMPORT_ALIASES)
    if (columns.postCode === undefined) {
      throw new BizException(BizErrorCode.IMPORT_HEADER_MISMATCH, '未找到「岗位编码」列，请使用导入模板的表头', HttpStatus.BAD_REQUEST)
    }
    assertImportRows(dataRows)

    const [existing, depts] = await Promise.all([this.postRepository.find(), this.postRepository.manager.find(DeptEntity, { where: { delFlag: '0' } })])
    const byCode = new Map(existing.map(post => [post.postCode.trim().toLowerCase(), post]))
    const deptByName = new Map(depts.map(dept => [dept.departName.trim().toLowerCase(), dept]))
    const seen = new Set<string>()
    const result = createImportResult(dataRows.length)

    for (const { rowNumber, cells } of dataRows) {
      const postCode = pickCell(columns, cells, 'postCode')
      const postName = pickCell(columns, cells, 'postName')
      if (!postCode) {
        failImportRow(result, rowNumber, '岗位编码不能为空')
        continue
      }
      if (postCode.length > 100) {
        failImportRow(result, rowNumber, '岗位编码最长 100 个字符', postCode)
        continue
      }
      const codeKey = postCode.toLowerCase()
      if (seen.has(codeKey)) {
        result.skipped += 1
        result.errors.push({ row: rowNumber, key: postCode, message: '文件内岗位编码重复，本行已跳过' })
        continue
      }
      seen.add(codeKey)

      const current = byCode.get(codeKey)
      if (!postName && !current) {
        failImportRow(result, rowNumber, '岗位名称不能为空', postCode)
        continue
      }
      const postSort = parsePositiveInt(pickCell(columns, cells, 'postSort'), 0)
      if (postSort === undefined) {
        failImportRow(result, rowNumber, '排序必须是 0 或正整数', postCode)
        continue
      }
      const statusText = pickCell(columns, cells, 'status')
      const status = parseSwitchText(statusText)
      if (statusText && status === undefined) {
        failImportRow(result, rowNumber, '状态请填「正常」或「停用」', postCode)
        continue
      }

      const deptName = pickCell(columns, cells, 'deptName')
      const dept = deptName ? deptByName.get(deptName.toLowerCase()) : undefined
      if (deptName && !dept) {
        failImportRow(result, rowNumber, `所属部门「${deptName}」不存在，请先在部门管理中创建`, postCode)
        continue
      }
      const description = pickCell(columns, cells, 'description') || undefined

      if (current) {
        await this.postRepository.update(current.id, {
          ...(postName ? { postName } : {}),
          postSort,
          ...(dept ? { deptId: dept.id } : {}),
          ...(status ? { status } : {}),
          ...(description !== undefined ? { description } : {}),
          updateBy: operator,
          updateTime: new Date()
        })
        result.updated += 1
        continue
      }

      const created = await this.create({
        postCode,
        postName,
        postSort,
        deptId: dept?.id ?? null,
        status: status ?? '1',
        description,
        createBy: operator,
        createTime: new Date()
      })
      byCode.set(codeKey, created)
      result.created += 1
    }

    return result
  }

  /** 批量删除：逐条硬删，单条失败返回原因 */
  async batchDelete(ids: string[]): Promise<BatchDeleteResult> {
    const targets = await this.postRepository.findBy({ id: In(normalizeBatchIds(ids)) })
    return runBatchDelete(
      targets,
      {
        getId: post => post.id,
        getName: post => post.postName,
        remove: post => this.delete(post.id)
      },
      ids
    )
  }
}
