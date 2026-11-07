import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, Length } from 'class-validator'

import { MESSAGE_TYPES } from '../entities/sys-message.entity'

export class SendMessageDto {
  @ApiProperty({ description: '标题', example: '系统维护通知', maxLength: 128 })
  @IsString()
  @Length(1, 128, { message: '标题长度须在 1~128 位之间' })
  title: string

  @ApiProperty({ description: '正文', maxLength: 5000 })
  @IsString()
  @Length(1, 5000, { message: '正文长度须在 1~5000 位之间' })
  content: string

  @ApiPropertyOptional({ description: '消息类型：send 手动发送 / system 系统通知', example: 'send', enum: MESSAGE_TYPES })
  @IsOptional()
  @IsIn(MESSAGE_TYPES as unknown as string[])
  msgType?: string

  @ApiProperty({
    description: '接收人列表：用户 ID 或用户名混填，1~1000 个',
    example: ['admin'],
    maxItems: 1000
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  @Length(1, 32, { each: true, message: '接收人 ID 长度须在 1~32 位之间' })
  userIds: string[]
}

export class QueryMessageDto {
  @ApiPropertyOptional({ description: '标题模糊过滤', example: '维护' })
  @IsOptional()
  @IsString()
  @Length(1, 128)
  keyword?: string

  @ApiPropertyOptional({ description: '消息类型过滤', example: 'send', enum: MESSAGE_TYPES })
  @IsOptional()
  @IsIn(MESSAGE_TYPES as unknown as string[])
  msgType?: string
}

export class QueryMyMessageDto {
  @ApiPropertyOptional({ description: '只看未读', example: true })
  @IsOptional()
  @IsIn([0, 1, '0', '1'])
  unread?: number | string
}
