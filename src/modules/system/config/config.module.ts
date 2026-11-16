import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { ConfigV1Controller } from './config.v1.controller'
import { SysConfigEntity } from './entities/sys-config.entity'
import { SystemConfigService } from './system-config.service'

/**
 * 系统参数模块
 *
 * 被 AuthModule 引用（密码策略、登录失败上限），所以 service 必须 export。
 * 注意：不要在这里 import AuthModule，否则循环依赖。
 */
@Module({
  imports: [TypeOrmModule.forFeature([SysConfigEntity])],
  controllers: [ConfigV1Controller],
  providers: [SystemConfigService],
  exports: [SystemConfigService]
})
export class SystemConfigModule {}
