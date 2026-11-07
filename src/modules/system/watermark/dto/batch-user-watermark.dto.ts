import { ApiProperty } from '@nestjs/swagger'
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsIn, IsString } from 'class-validator'

import { BATCH_DELETE_MAX } from '../../../../helper/crud/batch-delete'

/**
 * 批量水印动作（三档，语义与单个用户弹窗的「管控方式」一致）
 *
 * - on      强制开启：enabled=1 + enforced=1，全局策略关掉也照样显示
 * - off     强制关闭：enabled=0 + enforced=2，全局强制开启也照样不显示
 * - inherit 恢复跟随全局：清掉个人开关/内容/密度，enforced 归 0
 *
 * 刻意不暴露 enabled/enforced 的任意组合：批量场景下「开但强制关」这类矛盾组合没人想要，
 * 单用户的精细组合仍然走 PUT users/:id/watermark。
 */
export const BATCH_WATERMARK_MODES = ['on', 'off', 'inherit'] as const
export type BatchWatermarkMode = (typeof BATCH_WATERMARK_MODES)[number]

export class BatchUserWatermarkDto {
  @ApiProperty({
    description: `目标用户 ID 列表，单次最多 ${BATCH_DELETE_MAX} 条；不存在/已删除的会被跳过并在结果里返回`,
    type: [String],
    example: ['e9ca23d68d884d4ebb19d07889727dae']
  })
  @IsArray({ message: 'ids 必须是数组' })
  @ArrayNotEmpty({ message: '请选择要操作的用户' })
  @ArrayMaxSize(BATCH_DELETE_MAX, { message: `单次最多操作 ${BATCH_DELETE_MAX} 条` })
  @IsString({ each: true, message: '每个 id 必须是字符串' })
  ids!: string[]

  @ApiProperty({
    description: 'on 强制开启（用户关不掉）/ off 强制关闭（用户开不了）/ inherit 清除个人设置恢复跟随全局',
    enum: BATCH_WATERMARK_MODES,
    example: 'on'
  })
  @IsIn([...BATCH_WATERMARK_MODES], { message: 'mode 只能是 on / off / inherit' })
  mode!: BatchWatermarkMode
}
