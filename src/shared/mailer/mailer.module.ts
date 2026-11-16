import { Module } from '@nestjs/common'

import { SystemConfigModule } from '../../modules/system/config/config.module'
import { MailerService } from './mailer.service'

/**
 * 邮件通道（SMTP）
 *
 * 依赖 SystemConfigModule 读 `mail.enabled` / `mail.from`；
 * 不依赖 AuthModule（会形成 auth → mailer → auth 的环）。
 */
@Module({
  imports: [SystemConfigModule],
  providers: [MailerService],
  exports: [MailerService]
})
export class MailerModule {}
