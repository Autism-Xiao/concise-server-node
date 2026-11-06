import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator'

import { WATERMARK_DENSITIES, type WatermarkDensity } from '../watermark.util'

/**
 * 用户修改自己的水印
 *
 * 刻意只开放 enabled / content / density 三项：
 * opacity、rotate、fontSize 属于样式参数，由全局策略统一控制，
 * 否则用户把不透明度调成 0 就等于把水印关掉了，后端管控形同虚设。
 * 多传的字段会被全局 ValidationPipe 的 whitelist 直接丢弃。
 */
export class UpdateMyWatermarkDto {
  @ApiPropertyOptional({ description: '开关；传 null 表示恢复继承全局默认', nullable: true, example: false })
  @IsOptional()
  @IsBoolean({ message: 'enabled 必须是布尔值' })
  enabled?: boolean | null

  @ApiPropertyOptional({ description: '自定义内容模板；留空或 null 表示跟随全局。支持 {username} {nickname} {dept} {ip} {date} {time}', nullable: true })
  @IsOptional()
  @IsString({ message: 'content 必须是字符串' })
  @MaxLength(200, { message: '水印内容不能超过 200 个字符' })
  content?: string | null

  @ApiPropertyOptional({ description: '密度：compact 紧凑 / default 标准 / loose 宽松；null 表示跟随全局', enum: WATERMARK_DENSITIES, nullable: true })
  @IsOptional()
  @IsIn([...WATERMARK_DENSITIES], { message: '密度只能是 compact / default / loose' })
  density?: WatermarkDensity | null
}
