import { Global, Module } from '@nestjs/common'

import { SystemConfigModule } from '../../modules/system/config/config.module'
import { QuotaService } from './quota.service'

/** 资源配额：被用户、租户成员分配、文件中心共用，做成全局模块避免每个业务模块重复 import */
@Global()
@Module({
  imports: [SystemConfigModule],
  providers: [QuotaService],
  exports: [QuotaService]
})
export class QuotaModule {}
