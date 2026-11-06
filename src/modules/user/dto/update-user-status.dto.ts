import { ApiProperty } from '@nestjs/swagger'
import { IsIn } from 'class-validator'

/** 冻结/解冻：1 正常 / 2 冻结（冻结自动踢掉全部在线会话） */
export class UpdateUserStatusDto {
  @ApiProperty({ description: '目标状态：1 正常 / 2 冻结', enum: [1, 2], example: 2 })
  @IsIn([1, 2], { message: '状态只允许 1（正常）或 2（冻结）' })
  status!: number
}
