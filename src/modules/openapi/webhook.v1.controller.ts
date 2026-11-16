import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator'

import { Perms } from '../../common/decorators/perms.decorator'
import { PagerDto } from '../../common/dto/pager.dto'
import { WebhookService } from './webhook.service'
import { WEBHOOK_EVENT_KEYS } from './openapi.constants'

class CreateWebhookDto {
  @ApiProperty({ description: '订阅事件', enum: WEBHOOK_EVENT_KEYS, example: 'user.created' })
  @IsIn([...WEBHOOK_EVENT_KEYS], { message: '订阅事件不在支持清单内' })
  event!: string

  @ApiProperty({ description: '回调地址（仅 https）' })
  @IsString({ message: '回调地址必须是字符串' })
  @Length(1, 500, { message: '回调地址最长 500 字' })
  @Matches(/^https:\/\//, { message: '回调地址必须以 https:// 开头' })
  url!: string

  @ApiPropertyOptional({ description: '所属应用 ID（空=平台级订阅）' })
  @IsOptional()
  @IsString({ message: '所属应用必须是字符串' })
  appId?: string
}

class UpdateWebhookDto {
  @ApiPropertyOptional({ description: '订阅事件', enum: WEBHOOK_EVENT_KEYS })
  @IsOptional()
  @IsIn([...WEBHOOK_EVENT_KEYS], { message: '订阅事件不在支持清单内' })
  event?: string

  @ApiPropertyOptional({ description: '回调地址（仅 https）' })
  @IsOptional()
  @IsString({ message: '回调地址必须是字符串' })
  @Length(1, 500, { message: '回调地址最长 500 字' })
  @Matches(/^https:\/\//, { message: '回调地址必须以 https:// 开头' })
  url?: string

  @ApiPropertyOptional({ description: '状态（0 启用 / 1 停用）', enum: ['0', '1'] })
  @IsOptional()
  @IsIn(['0', '1'], { message: '状态只允许 0（启用）或 1（停用）' })
  status?: string
}

/**
 * Webhook 订阅管理（/api/v1/webhooks）
 *
 * 订阅的 secret 创建时自动生成（256 位随机），创建后不再回显完整值
 * —— 接收方验签要拿它，所以管理端有"复制密钥"入口（查询单条接口不返回，防截图泄露）。
 */
@ApiTags('开放平台')
@ApiBearerAuth('jwt')
@Controller('v1/webhooks')
export class WebhookV1Controller {
  constructor(private readonly webhookService: WebhookService) {}

  @ApiOperation({ summary: '订阅分页列表' })
  @Perms('system:app:list')
  @Get()
  list(@Query() query: PagerDto) {
    return this.webhookService.list(query)
  }

  @ApiOperation({ summary: '创建订阅', description: '签名密钥自动生成；URL 只接受 https' })
  @Perms('system:webhook:create')
  @Post()
  create(@Body() dto: CreateWebhookDto) {
    return this.webhookService.create(dto)
  }

  @ApiOperation({ summary: '编辑订阅（URL/事件/启停）' })
  @Perms('system:webhook:update')
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateWebhookDto) {
    return this.webhookService.update(id, dto)
  }

  @ApiOperation({ summary: '删除订阅（软删）', description: '历史投递流水保留' })
  @Perms('system:webhook:delete')
  @Delete(':id')
  async delete(@Param('id') id: string) {
    await this.webhookService.delete(id)
    return { deleted: true }
  }

  @ApiOperation({ summary: '连通性测试', description: '派发一条 webhook.test 事件，结果在投递流水里看（不直接同步返回 HTTP 结果）' })
  @Perms('system:webhook:update')
  @Post(':id/test')
  sendTest(@Param('id') id: string) {
    return this.webhookService.sendTest(id)
  }

  @ApiOperation({ summary: '投递流水（倒序）', description: '每次派发一行：最终成败、尝试次数、最后一次响应码/失败原因' })
  @Perms('system:app:list')
  @Get(':id/deliveries')
  listDeliveries(@Param('id') id: string, @Query() query: PagerDto) {
    return this.webhookService.listDeliveries(id, query)
  }
}
