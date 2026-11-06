import { BadRequestException } from '@nestjs/common'

import { parseCsv } from '../../utils/csv.util'
import { readXlsxTable, type XlsxTable } from '../../utils/xlsx.util'

/**
 * 导入文件读取公共件
 *
 * 各模块的导入前处理完全一样：校验有没有文件 → 按扩展名选解析器 → 统一报错文案。
 * 之前每个控制器都抄一遍这段分支，文案还各自微调；收敛到这里后，新增模块只写列映射与业务校验。
 *
 * 约定（与用户管理一致）：
 * - .xlsx 为推荐格式，可带大标题与填写说明（靠 headerKeys 定位表头）
 * - .csv 兼容但必须是 UTF-8；出现替换字符（\uFFFD）说明是 GBK，直接拒绝并提示另存
 * - 返回 { rows, headerRow }，交给模块自己的 Service 做列定位与逐行校验
 */

/** 读取选项 */
export interface ReadImportFileOptions {
  /** 表头关键字：用于跳过模板的大标题/说明行（如 ['登录账号', '账号']） */
  headerKeys: string[]
  /** 是否接受 .csv，默认 true；只做 Excel 模板的模块传 false，错误提示更明确 */
  allowCsv?: boolean
}

/** 未选文件时的统一提示 */
export const IMPORT_FILE_REQUIRED = '未接收到文件，请选择 Excel 后重试'

/**
 * 读取上传的导入文件
 *
 * @throws BadRequestException 未选文件 / 扩展名不支持 / CSV 非 UTF-8
 */
export async function readImportFile(file: Express.Multer.File | undefined, options: ReadImportFileOptions): Promise<XlsxTable> {
  if (!file) {
    throw new BadRequestException(IMPORT_FILE_REQUIRED)
  }
  const filename = file.originalname ?? ''
  const allowCsv = options.allowCsv ?? true

  if (/\.xlsx$/i.test(filename)) {
    return readXlsxTable(file.buffer, { headerKeys: options.headerKeys })
  }

  if (allowCsv && /\.csv$/i.test(filename)) {
    const text = file.buffer.toString('utf8')
    // GBK 编码的中文在 UTF-8 下会变成替换字符，此时解析出来全是乱码，宁可拒绝也不要静默导错
    if (text.includes('\uFFFD')) {
      throw new BadRequestException('CSV 文件编码不是 UTF-8，请改用 .xlsx 导入，或另存为「CSV UTF-8（逗号分隔）」')
    }
    return { rows: parseCsv(text), headerRow: 1 }
  }

  throw new BadRequestException(allowCsv ? '仅支持 .xlsx（推荐）或 .csv 文件' : '仅支持 .xlsx 文件，请下载模板填写后导入')
}
