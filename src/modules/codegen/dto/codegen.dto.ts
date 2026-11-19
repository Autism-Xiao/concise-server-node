import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested
} from 'class-validator'

/** 生成器支持的字段类型（与 scripts/gen-module.cjs 的 TYPE_MAP 一一对应） */
export const CODEGEN_FIELD_TYPES = ['string', 'text', 'int', 'bigint', 'tinyint', 'decimal', 'datetime', 'bool', 'enum'] as const
export type CodegenFieldType = (typeof CODEGEN_FIELD_TYPES)[number]

export class CodegenEnumValueDto {
  @ApiProperty({ description: '枚举值（落 tinyint，必须是数字）' })
  @Type(() => Number)
  @IsInt()
  value: number

  @ApiProperty({ description: '枚举标签' })
  @IsString()
  @MaxLength(32)
  label: string
}

export class CodegenFieldDto {
  @ApiProperty({ description: '字段名（小写蛇形，落列名）', example: 'customer_name' })
  @IsString()
  @Matches(/^[a-z][a-z0-9_]{0,31}$/, { message: '字段名须为小写蛇形，且不超过 32 字符' })
  name: string

  @ApiProperty({ description: '字段类型', enum: CODEGEN_FIELD_TYPES })
  @IsIn(CODEGEN_FIELD_TYPES as unknown as string[])
  type: CodegenFieldType

  @ApiPropertyOptional({ description: '中文备注（同时作列表表头与表单 label）' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  comment?: string

  @ApiPropertyOptional({ description: '必填（entity 非空 + DTO @IsNotEmpty + 表单必填）' })
  @IsOptional()
  @IsBoolean()
  required?: boolean

  @ApiPropertyOptional({ description: '唯一（按租户唯一，含软删占用查重）' })
  @IsOptional()
  @IsBoolean()
  unique?: boolean

  @ApiPropertyOptional({ description: '列表精确查询过滤项' })
  @IsOptional()
  @IsBoolean()
  query?: boolean

  @ApiPropertyOptional({ description: '关键字模糊搜索项' })
  @IsOptional()
  @IsBoolean()
  search?: boolean

  @ApiPropertyOptional({ description: '默认值（enum/bool 传 0/1 之类的枚举值）' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  default?: string

  @ApiPropertyOptional({ description: '枚举值列表（仅 type=enum）', type: [CodegenEnumValueDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CodegenEnumValueDto)
  enumValues?: CodegenEnumValueDto[]
}

export class PreviewCodegenDto {
  @ApiProperty({ description: '模块标识（小写蛇形，决定目录名/表名/权限前缀）', example: 'biz_order' })
  @IsString()
  @Matches(/^[a-z][a-z0-9_]{1,31}$/, { message: '模块标识须为小写蛇形，2~32 字符' })
  module: string

  @ApiProperty({ description: '模块中文名（菜单名 + 页面标题）', example: '订单' })
  @IsString()
  @MaxLength(32)
  label: string

  @ApiPropertyOptional({ description: '按钮权限前缀，默认同模块标识' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z][a-z0-9_]{1,31}$/, { message: '权限前缀须为小写蛇形' })
  perms?: string

  @ApiPropertyOptional({ description: '物理表名，默认同模块标识' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z][a-z0-9_]{1,63}$/, { message: '表名须为小写蛇形' })
  table?: string

  @ApiPropertyOptional({ description: '菜单挂载的父节点 id，默认 menu_collab', example: 'menu_collab' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  menuParent?: string

  @ApiPropertyOptional({ description: '菜单排序号，默认 50' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  sort?: number

  @ApiPropertyOptional({ description: '菜单图标（lucide 组件名），默认 Briefcase' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z][A-Za-z0-9]{1,31}$/, { message: '图标须为 lucide 组件名（PascalCase）' })
  icon?: string

  @ApiProperty({ description: '字段定义（至少 1 个，最多 40 个）', type: [CodegenFieldDto] })
  @IsArray()
  @ArrayMinSize(1, { message: '至少定义一个业务字段' })
  @ArrayMaxSize(40, { message: '字段不超过 40 个，超宽表请拆表' })
  @ValidateNested({ each: true })
  @Type(() => CodegenFieldDto)
  fields: CodegenFieldDto[]

  @ApiPropertyOptional({ description: '目标模块已存在时允许重新生成：同名文件先备份到 .codegen-backup 再覆盖；不带此参数遇到已存在模块会报 9201' })
  @IsOptional()
  @IsBoolean()
  force?: boolean
}

/** 生成请求 = 预览请求 + force，单独命名让 Swagger 语义清楚 */
export class GenerateCodegenDto extends PreviewCodegenDto {}
