import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { UserModule } from '../../user/user.module'
import { UserWatermarkEntity } from './entities/user-watermark.entity'
import { WatermarkSettingEntity } from './entities/watermark-setting.entity'
import { WatermarkController } from './watermark.controller'
import { WatermarkService } from './watermark.service'

/**
 * 页面水印模块
 *
 * 依赖 UserModule 只为「给指定用户设置水印时校验用户存在」；
 * UserModule 反过来不依赖本模块（列表摘要直接用仓库 + 纯函数计算），因此不存在循环引用。
 */
@Module({
  imports: [TypeOrmModule.forFeature([WatermarkSettingEntity, UserWatermarkEntity]), UserModule],
  controllers: [WatermarkController],
  providers: [WatermarkService],
  exports: [WatermarkService]
})
export class WatermarkModule {}
