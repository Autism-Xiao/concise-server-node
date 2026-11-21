import { Module } from '@nestjs/common'

import { SystemConfigModule } from '../../modules/system/config/config.module'
import { SmsService } from './sms.service'

/**
 * 短信通道（阿里云 / 腾讯云）
 *
 * 依赖 SystemConfigModule 读 `sms.enabled` / `sms.provider`；
 * 与 MailerModule 同构：凭证在环境变量（SMS_*），这里不落库。
 */
@Module({
  imports: [SystemConfigModule],
  providers: [SmsService],
  exports: [SmsService]
})
export class SmsModule {}
