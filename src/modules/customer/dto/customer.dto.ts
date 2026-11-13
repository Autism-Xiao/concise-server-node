import { IsOptional, IsNotEmpty, IsString, IsInt, IsIn, MaxLength } from 'class-validator'
import { Type } from 'class-transformer'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class CreateCustomerDto {
  @ApiProperty({ description: '客户名称' })
  @IsNotEmpty({ message: '客户名称不能为空' })
  @IsString()
  name: string

  @ApiPropertyOptional({ description: '联系人', nullable: true })
  @IsOptional()
  @IsString()
  contact?: string

  @ApiPropertyOptional({ description: '电话', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(128, { message: '电话最长 128 位' })
  phone?: string

  @ApiPropertyOptional({ description: '级别', nullable: true })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  level?: number

  @ApiPropertyOptional({ description: '客户等级', nullable: true })
  @IsOptional()
  @IsInt()
  @IsIn([0, 1], { message: '客户等级取值不合法' })
  @Type(() => Number)
  vip?: number

  @ApiPropertyOptional({ description: '备注', nullable: true })
  @IsOptional()
  @IsString()
  remark?: string
}

export class UpdateCustomerDto {
  @ApiPropertyOptional({ description: '客户名称', nullable: true })
  @IsOptional()
  @IsString()
  name?: string | null

  @ApiPropertyOptional({ description: '联系人', nullable: true })
  @IsOptional()
  @IsString()
  contact?: string | null

  @ApiPropertyOptional({ description: '电话', nullable: true })
  @IsOptional()
  @IsString()
  phone?: string | null

  @ApiPropertyOptional({ description: '级别', nullable: true })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  level?: number | null

  @ApiPropertyOptional({ description: '客户等级', nullable: true })
  @IsOptional()
  @IsInt()
  @IsIn([0, 1], { message: '客户等级取值不合法' })
  @Type(() => Number)
  vip?: number | null

  @ApiPropertyOptional({ description: '备注', nullable: true })
  @IsOptional()
  @IsString()
  remark?: string | null
}

/** 列表查询参数：page/pageSize 必须显式转数字，否则 ValidationPipe 白名单会丢弃字符串形态的分页 */
export class ListCustomerDto {
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
}
