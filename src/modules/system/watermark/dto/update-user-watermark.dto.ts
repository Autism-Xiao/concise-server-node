import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator'

import { WATERMARK_DENSITIES, type WatermarkDensity } from '../watermark.util'

/**
 * 管理员给指定用户设置水印（"按用户单独开关"的入口）
 *
 * enforced 是强管控档，命中后该用户在前端无法自行修改：
 *  - 0 不强制（按全局策略）
 *  - 1 强制开启（用户关不掉）
 *  - 2 强制关闭（用户开不了）
 */
export class UpdateUserWatermarkDto {
  @ApiPropertyOptional({ description: '开关；null 表示恢复继承全局默认', nullable: true, example: true })
  @IsOptional()
  @IsBoolean({ message: 'enabled 必须是布尔值' })
  enabled?: boolean | null

  @ApiPropertyOptional({ description: '强管控：0 不强制 / 1 强制开 / 2 强制关', example: 1, enum: [0, 1, 2] })
  @IsOptional()
  @IsIn([0, 1, 2], { message: 'enforced 只能是 0（不强制）/ 1（强制开）/ 2（强制关）' })
  enforced?: number

  @ApiPropertyOptional({ description: '该用户的自定义内容模板；null 表示跟随全局', nullable: true })
  @IsOptional()
  @IsString({ message: 'content 必须是字符串' })
  @MaxLength(200, { message: '水印内容不能超过 200 个字符' })
  content?: string | null

  @ApiPropertyOptional({ description: '该用户的自定义密度；null 表示跟随全局', enum: WATERMARK_DENSITIES, nullable: true })
  @IsOptional()
  @IsIn([...WATERMARK_DENSITIES], { message: '密度只能是 compact / default / loose' })
  density?: WatermarkDensity | null
}
