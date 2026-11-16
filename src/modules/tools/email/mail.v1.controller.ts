import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger'
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator'

import { Perms } from '../../../common/decorators/perms.decorator'
import { RateLimit } from '../../../common/decorators/rate-limit.decorator'
import { MailerService } from '../../../shared/mailer/mailer.service'

export class TestMailDto {
  @ApiProperty({ description: '收件邮箱', example: 'ops@example.com' })
  @IsEmail({}, { message: '收件邮箱格式不正确' })
  to!: string

  @ApiProperty({ description: '备注（会写进邮件正文，便于确认这封信是谁发的）', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(50, { message: '备注最长 50 字' })
  remark?: string
}

/**
 * 邮件通道运维接口：/api/v1/mail/**
 *
 * 只有看/测，没有"随便发一封"的通用接口 —— 开放任意收件人 + 任意正文等于给系统
 * 装了一个可被滥用的发信器（垃圾邮件通道），测试调用只发固定模板。
 * 权限复用配置中心的 `system:config:update`：能改 mail.enabled 的人本来就该能测连通性。
 */
@ApiTags('邮件通道 V1')
@ApiBearerAuth('jwt')
@Controller('v1/mail')
export class MailV1Controller {
  constructor(private readonly mailer: MailerService) {}

  @ApiOperation({
    summary: '邮件通道状态',
    description: '返回是否开启、SMTP 连接信息（不含密码）、默认发件人，以及内存 outbox 条数'
  })
  @Perms('system:config:list')
  @Get('status')
  status() {
    return this.mailer.status()
  }

  @ApiOperation({ summary: 'SMTP 连通性检查', description: '只建连不发信；配置错误时返回具体原因' })
  @Perms('system:config:update')
  @Get('verify')
  verify() {
    return this.mailer.verify()
  }

  @ApiOperation({
    summary: '发送测试邮件',
    description: '发一封固定模板的测试信。要求 mail.enabled=true 且 SMTP 配置齐全，否则直接返回未开启原因'
  })
  @Perms('system:config:update')
  @RateLimit({ limit: 5, window: 60, message: '测试发信过于频繁，请稍后再试' })
  @HttpCode(HttpStatus.OK)
  @Post('test')
  test(@Body() dto: TestMailDto) {
    return this.mailer.sendTest(dto.to, dto.remark)
  }

  @ApiOperation({
    summary: '最近发信记录',
    description: '内存环形缓冲，最多 20 条，重启即丢。dry-run（未配置/未开启）时带邮件正文，方便本地取验证码'
  })
  @Perms('system:config:update')
  @Get('outbox')
  outbox(@Query('limit') limit?: string) {
    const size = Number(limit ?? 20)
    return this.mailer.getOutbox(Number.isFinite(size) && size > 0 ? Math.min(size, 50) : 20)
  }
}
