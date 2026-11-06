import { ApiPropertyOptional } from '@nestjs/swagger'
import { PartialType } from '@nestjs/swagger'
import { IsOptional, Matches } from 'class-validator'
import { CreateRegionDto } from './create-region.dto'

/** 更新区划：全部字段可选；areaCode/parentCode 仍要求是数字代码格式（传了才校验） */
export class UpdateRegionDto extends PartialType(CreateRegionDto) {
  @ApiPropertyOptional({ description: '区划代码（全局唯一）', example: '440300000001' })
  @IsOptional()
  @Matches(/^\d{6,20}$/, { message: '区划代码需为 6-20 位数字' })
  areaCode?: string

  @ApiPropertyOptional({ description: '上级区划代码，顶级传 "0"', example: '440000000000' })
  @IsOptional()
  @Matches(/^\d{6,20}$/, { message: '上级区划代码需为 6-20 位数字' })
  parentCode?: string
}
