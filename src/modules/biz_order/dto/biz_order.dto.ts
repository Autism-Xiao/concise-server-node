import { IsOptional, IsNotEmpty, IsString, IsInt, IsNumber, IsISO8601, IsIn, MaxLength } from 'class-validator'
import { Type } from 'class-transformer'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class CreateBizOrderDto {
  @ApiProperty({ description: '标题' })
  @IsNotEmpty({ message: '标题不能为空' })
  @IsString()
  title: string

  @ApiPropertyOptional({ description: '状态', nullable: true })
  @IsOptional()
  @IsInt()
  @IsIn([1, 0], { message: '状态取值不合法' })
  @Type(() => Number)
  status?: number

  @ApiPropertyOptional({ description: '金额', nullable: true })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  amount?: number

  @ApiPropertyOptional({ description: '签约时间', nullable: true })
  @IsOptional()
  @IsISO8601()
  signedAt?: string

  @ApiPropertyOptional({ description: '备注', nullable: true })
  @IsOptional()
  @IsString()
  remark?: string
}

export class UpdateBizOrderDto {
  @ApiPropertyOptional({ description: '标题', nullable: true })
  @IsOptional()
  @IsString()
  title?: string | null

  @ApiPropertyOptional({ description: '状态', nullable: true })
  @IsOptional()
  @IsInt()
  @IsIn([1, 0], { message: '状态取值不合法' })
  @Type(() => Number)
  status?: number | null

  @ApiPropertyOptional({ description: '金额', nullable: true })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  amount?: number | null

  @ApiPropertyOptional({ description: '签约时间', nullable: true })
  @IsOptional()
  @IsISO8601()
  signedAt?: string | null

  @ApiPropertyOptional({ description: '备注', nullable: true })
  @IsOptional()
  @IsString()
  remark?: string | null
}

/** 列表查询参数：page/pageSize 必须显式转数字，否则 ValidationPipe 白名单会丢弃字符串形态的分页 */
export class ListBizOrderDto {
  @ApiPropertyOptional({ description: '页码，从 1 起' })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  page?: number

  @ApiPropertyOptional({ description: '每页条数' })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  pageSize?: number

  @ApiPropertyOptional({ description: '模糊搜索关键字' })
  @IsOptional()
  @MaxLength(64, { message: '关键字最长 64 位' })
  keyword?: string

  @ApiPropertyOptional({ description: '按状态精确过滤' })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  status?: number
}
