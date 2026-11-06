import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator'

/** 层级与文本的对照（levelText 由后端按 level 推导，避免前后端不一致） */
export const REGION_LEVELS = [0, 1, 2, 3] as const
export const REGION_LEVEL_TEXTS: Record<number, string> = { 0: '省份', 1: '城市', 2: '区县', 3: '街道' }

export class CreateRegionDto {
  @ApiProperty({ description: '名称', example: '深圳市' })
  @IsString()
  @Length(1, 100, { message: '名称长度需在 1-100 之间' })
  name: string

  @ApiProperty({ description: '区划代码（全局唯一）', example: '440300000000' })
  @IsString()
  @Matches(/^\d{6,20}$/, { message: '区划代码需为 6-20 位数字' })
  areaCode: string

  @ApiProperty({ description: '上级区划代码，顶级传 "0"', example: '440000000000' })
  @IsString()
  @Matches(/^\d{6,20}$/, { message: '上级区划代码需为 6-20 位数字' })
  parentCode: string

  @ApiProperty({ description: '层级：0 省份 / 1 城市 / 2 区县 / 3 街道', example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3)
  @IsIn(REGION_LEVELS as unknown as number[])
  level: number

  @ApiPropertyOptional({ description: '简称', example: '深圳' })
  @IsOptional()
  @IsString()
  @Length(0, 50)
  shortName?: string

  @ApiPropertyOptional({ description: '全称', example: '深圳' })
  @IsOptional()
  @IsString()
  @Length(0, 100)
  fullName?: string

  @ApiPropertyOptional({ description: '拼音', example: 'ShenZhen' })
  @IsOptional()
  @IsString()
  @Length(0, 100)
  pinyin?: string

  @ApiPropertyOptional({ description: '城市代码（电话区号）', example: '0755' })
  @IsOptional()
  @IsString()
  @Length(0, 10)
  cityCode?: string

  @ApiPropertyOptional({ description: '邮政编码', example: '518000' })
  @IsOptional()
  @IsString()
  @Length(0, 10)
  zipCode?: string

  @ApiPropertyOptional({ description: '经度', example: '114.057868' })
  @IsOptional()
  @IsString()
  @Length(0, 20)
  lng?: string

  @ApiPropertyOptional({ description: '纬度', example: '22.543099' })
  @IsOptional()
  @IsString()
  @Length(0, 20)
  lat?: string
}
