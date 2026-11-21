import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger'
import { Matches } from 'class-validator'

import { Perms } from '../../../common/decorators/perms.decorator'
import { SmsService } from '../../../shared/sms/sms.service'

export class TestSmsDto {
  @ApiProperty({ description: '收信手机号（大陆号码）', example: '13800000000' })
  @Matches(/^1\d{10}$/, { message: '手机号格式不正确' })
  to!: string
}

/**
 * 短信通道运维接口：/api/v1/sms/**
 *
 * 与 mail.v1.controller 同一套边界：只有「看状态 / 看记录 / 发固定模板测试」，没有
 * 「任意手机号 + 任意内容」的通用接口 —— 那等于卖了一个可被滥用的短信群发器。
 * 权限复用 system:config:list / update（能改 sms.enabled 的人本来就该能测连通性）。
 */
@ApiTags('短信通道 V1')
@ApiBearerAuth('jwt')
@Controller('v1/sms')
export class SmsV1Controller {
  constructor(private readonly sms: SmsService) {}

  @ApiOperation({ summary: '短信通道状态', description: '通道选择、开关、凭证是否齐全（脱敏）、outbox 条数' })
  @Perms('system:config:list')
  @Get('status')
  status() {
    return this.sms.status()
  }

  @ApiOperation({ summary: '测试发送', description: '只发固定模板；dry-run（未配置/未开启）直接报未开启，避免"测试通过但根本没配"' })
  @Perms('system:config:update')
  @HttpCode(HttpStatus.OK)
  @Post('test')
  test(@Body() dto: TestSmsDto) {
    return this.sms.sendTest(dto.to)
  }

  @ApiOperation({ summary: '最近发送记录', description: 'dry-run 记录带参数预览（本地取验证码用），仅最近 20 条' })
  @Perms('system:config:list')
  @Get('outbox')
  outbox() {
    return this.sms.getOutbox()
  }
}
