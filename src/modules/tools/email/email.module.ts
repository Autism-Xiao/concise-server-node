import { Module } from '@nestjs/common'

import { MailerModule } from '../../../shared/mailer/mailer.module'
import { MailV1Controller } from './mail.v1.controller'

/**
 * 邮件通道模块（运维侧）：状态 / 连通性检查 / 测试发信 / 发信记录。
 * 业务侧（忘记密码）由 AuthModule 直接用 MailerService，不经过这里。
 */
@Module({
  imports: [MailerModule],
  controllers: [MailV1Controller]
})
export class EmailModule {}
