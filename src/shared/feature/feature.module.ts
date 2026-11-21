import { Global, Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { SysConfigEntity } from '../../modules/system/config/entities/sys-config.entity'
import { SystemConfigModule } from '../../modules/system/config/config.module'
import { FeatureV1Controller } from './feature.v1.controller'
import { FeatureService } from './feature.service'

/**
 * 租户级特性开关：复用 sys_config 的 feature.* 键，不建新表。
 * 做成全局模块，业务模块直接注入 FeatureService / 使用 @FeatureFlag 即可。
 */
@Global()
@Module({
  imports: [SystemConfigModule, TypeOrmModule.forFeature([SysConfigEntity])],
  controllers: [FeatureV1Controller],
  providers: [FeatureService],
  exports: [FeatureService]
})
export class FeatureModule {}
