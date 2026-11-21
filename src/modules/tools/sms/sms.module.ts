import { Module } from '@nestjs/common'

import { SmsModule } from '../../../shared/sms/sms.module'
import { SmsV1Controller } from './sms.v1.controller'

/**
 * 短信通道模块（运维侧）：状态 / 测试发送 / 发送记录（outbox）。
 * 业务侧（验证码、到期提醒短信）直接注入 shared/sms 的 SmsService，不经过这里。
 */
@Module({
  imports: [SmsModule],
  controllers: [SmsV1Controller]
})
export class SmsToolModule {}
