import { IsNotEmpty, IsOptional, IsString, IsInt } from 'class-validator'
import { Type } from 'class-transformer'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class CreateSupplierDto {
  @ApiProperty({ description: '供应商名称' })
  @IsNotEmpty({ message: '供应商名称不能为空' })
  @IsString()
  name: string

  @ApiPropertyOptional({ description: '联系人', nullable: true })
  @IsOptional()
  @IsString()
  contact?: string

  @ApiPropertyOptional({ description: '级别', nullable: true })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  level?: number

  @ApiPropertyOptional({ description: '备注', nullable: true })
  @IsOptional()
  @IsString()
  remark?: string
}

export class UpdateSupplierDto {
  @ApiProperty({ description: '供应商名称' })
  @IsString()
  name: string | null

  @ApiPropertyOptional({ description: '联系人', nullable: true })
  @IsString()
  contact?: string | null

  @ApiPropertyOptional({ description: '级别', nullable: true })
  @IsInt()
  @Type(() => Number)
  level?: number | null

  @ApiPropertyOptional({ description: '备注', nullable: true })
  @IsString()
  remark?: string | null
}
