import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator'

import { WATERMARK_DENSITIES, WATERMARK_MODES, type WatermarkDensity, type WatermarkMode } from '../watermark.util'

/** 管理员修改全局水印策略：默认开关、策略模式、默认文案与样式参数 */
export class UpdateWatermarkSettingDto {
  @ApiPropertyOptional({ description: '全局默认开关，新用户继承此值', example: true })
  @IsOptional()
  @IsBoolean({ message: 'enabled 必须是布尔值' })
  enabled?: boolean

  @ApiPropertyOptional({
    description: '策略：optional 用户可自选 / forced 全站强制开 / off 全站关闭',
    example: 'optional',
    enum: WATERMARK_MODES
  })
  @IsOptional()
  @IsIn([...WATERMARK_MODES], { message: 'mode 只能是 optional / forced / off' })
  mode?: WatermarkMode

  @ApiPropertyOptional({ description: '默认内容模板（1~200 字符）', example: '{username}\n{date} {time}' })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: '默认水印内容不能为空' })
  @MaxLength(200, { message: '水印内容不能超过 200 个字符' })
  content?: string

  @ApiPropertyOptional({ description: '默认密度', enum: WATERMARK_DENSITIES })
  @IsOptional()
  @IsIn([...WATERMARK_DENSITIES], { message: '密度只能是 compact / default / loose' })
  density?: WatermarkDensity

  @ApiPropertyOptional({ description: '不透明度百分比（4~30，越大越显眼）', example: 8, minimum: 4, maximum: 30 })
  @IsOptional()
  @IsInt({ message: 'opacity 必须是整数' })
  @Min(4, { message: '不透明度不能低于 4%，否则等于没有水印' })
  @Max(30, { message: '不透明度不能高于 30%，否则会盖住正文' })
  opacity?: number

  @ApiPropertyOptional({ description: '倾斜角度（-60~0，负值向左倾斜）', example: -22, minimum: -60, maximum: 0 })
  @IsOptional()
  @IsInt({ message: 'rotate 必须是整数' })
  @Min(-60, { message: '倾斜角度不能小于 -60°' })
  @Max(0, { message: '倾斜角度不能大于 0°' })
  rotate?: number

  @ApiPropertyOptional({ description: '字号 px（10~24）', example: 14, minimum: 10, maximum: 24 })
  @IsOptional()
  @IsInt({ message: 'fontSize 必须是整数' })
  @Min(10, { message: '字号不能小于 10px' })
  @Max(24, { message: '字号不能大于 24px' })
  fontSize?: number
}
