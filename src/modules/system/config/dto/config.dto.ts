import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsArray, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator'

/** 单条参数更新：只允许改值，键与类型是内置元数据（防止把 number 改成乱码） */
export class UpdateConfigItemDto {
  @ApiProperty({ description: '参数键', example: 'security.password.minLength' })
  @IsNotEmpty({ message: '参数键不能为空' })
  @IsString()
  @MaxLength(128)
  configKey: string

  @ApiPropertyOptional({ description: '参数值（一律传字符串，后端按值类型校验）', example: '8', nullable: true })
  @IsOptional()
  @IsString()
  configValue?: string
}

/** 批量更新：一次提交一个分组，避免逐条请求 */
export class BatchUpdateConfigDto {
  @ApiProperty({ description: '要更新的参数列表', type: [UpdateConfigItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateConfigItemDto)
  items: UpdateConfigItemDto[]
}
