import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsBoolean, IsHexColor, IsOptional, IsString, Length } from 'class-validator'

export class CreateCalendarDto {
  @ApiProperty({ description: '日历名称', example: '我的日程' })
  @IsString()
  @Length(1, 50, { message: '日历名称长度需在 1-50 之间' })
  name: string

  @ApiPropertyOptional({ description: '颜色标识（十六进制）', example: '#1890ff', default: '#1890ff' })
  @IsOptional()
  @IsHexColor({ message: '颜色需为十六进制色值，如 #1890ff' })
  color?: string

  @ApiPropertyOptional({ description: '是否公开（公开日历的事件全员可见）', default: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isPublic?: boolean

  @ApiPropertyOptional({ description: '属主用户 ID（仅超管代建时使用，默认当前登录人）', example: 'e9ca23d68d884d4ebb19d07889727dae' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  ownerId?: string
}

export class UpdateCalendarDto extends PartialType(CreateCalendarDto) {}
