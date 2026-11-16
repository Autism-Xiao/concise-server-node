import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { IsIn, IsOptional, IsString, Length } from 'class-validator'

import { Perms } from '../../common/decorators/perms.decorator'
import { PagerDto } from '../../common/dto/pager.dto'
import { AppService } from './app.service'
import { APP_SCOPE_KEYS } from './openapi.constants'

class CreateAppDto {
  @ApiProperty({ description: '应用名称', example: '库存同步机器人' })
  @IsString({ message: '应用名称必须是字符串' })
  @Length(1, 64, { message: '应用名称长度须在 1~64' })
  appName!: string

  @ApiProperty({ description: '授权范围', example: ['user:read'], isArray: true, enum: APP_SCOPE_KEYS })
  @IsString({ each: true, message: '授权范围必须是字符串数组' })
  scopes!: string[]

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  @Length(0, 255, { message: '备注最长 255 字' })
  remark?: string
}

class UpdateAppDto {
  @ApiPropertyOptional({ description: '应用名称' })
  @IsOptional()
  @IsString({ message: '应用名称必须是字符串' })
  @Length(1, 64, { message: '应用名称长度须在 1~64' })
  appName?: string

  @ApiPropertyOptional({ description: '授权范围', isArray: true, enum: APP_SCOPE_KEYS })
  @IsOptional()
  @IsString({ each: true, message: '授权范围必须是字符串数组' })
  scopes?: string[]

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  @Length(0, 255, { message: '备注最长 255 字' })
  remark?: string

  @ApiPropertyOptional({ description: '状态（0 启用 / 1 停用）', enum: ['0', '1'] })
  @IsOptional()
  @IsIn(['0', '1'], { message: '状态只允许 0（启用）或 1（停用）' })
  status?: string
}

/**
 * 开放平台应用管理（/api/v1/apps）
 *
 * client_secret 的明文只在创建 / 重置的响应里出现一次，
 * 前端要立刻提示"离开本页后无法再次查看"。
 */
@ApiTags('开放平台')
@ApiBearerAuth('jwt')
@Controller('v1/apps')
export class AppV1Controller {
  constructor(private readonly appService: AppService) {}

  @ApiOperation({ summary: '应用分页列表', description: '带有效密钥前缀（识别用），不含任何完整密钥' })
  @Perms('system:app:list')
  @Get()
  list(@Query() query: PagerDto) {
    return this.appService.list(query)
  }

  @ApiOperation({ summary: '创建应用', description: '返回 client_id 与 client_secret；密钥明文只在本次响应出现，之后库里只有哈希' })
  @Perms('system:app:create')
  @Post()
  create(@Body() dto: CreateAppDto) {
    return this.appService.create(dto)
  }

  @ApiOperation({ summary: '编辑应用（名称/备注/授权范围/启停）', description: '改授权范围后需对接方重新换取令牌才生效（scope 在签发时写进令牌）' })
  @Perms('system:app:update')
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAppDto) {
    return this.appService.update(id, dto)
  }

  @ApiOperation({ summary: '删除应用（软删）', description: '同时撤销全部有效密钥：已签发的令牌到期前仍有效，到期后即彻底失效' })
  @Perms('system:app:delete')
  @Delete(':id')
  async delete(@Param('id') id: string) {
    await this.appService.delete(id)
    return { deleted: true }
  }

  @ApiOperation({ summary: '重置密钥', description: '旧版本密钥全部撤销、发新版本；新 client_secret 只在本次响应出现' })
  @Perms('system:app:reset')
  @Post(':id/reset-secret')
  resetSecret(@Param('id') id: string) {
    return this.appService.resetSecret(id)
  }
}
