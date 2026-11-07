import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { UserSettingEntity } from './entities/user-setting.entity'
import { UserSettingController } from './user-setting.controller'
import { UserSettingService } from './user-setting.service'

/**
 * 用户界面设置模块
 *
 * 纯个人偏好，不参与租户隔离（表里没有 tenant_id），也不依赖 UserModule —— user.id 来自 JWT。
 */
@Module({
  imports: [TypeOrmModule.forFeature([UserSettingEntity])],
  controllers: [UserSettingController],
  providers: [UserSettingService],
  exports: [UserSettingService]
})
export class UserSettingModule {}
