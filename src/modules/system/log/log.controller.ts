import { Controller, Get, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'

import { Perms } from '../../../common/decorators/perms.decorator'
import { PagerDto } from '../../../common/dto/pager.dto'
import { LogService } from './log.service'
import { LoginLogEntity } from './entities/login-log.entity'
import { OperLogEntity } from './entities/oper-log.entity'

class QueryLoginLogDto extends PagerDto {
  @ApiPropertyOptional({ description: '用户名模糊过滤', example: 'admin' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  username?: string

  @ApiPropertyOptional({ description: '结果过滤：0 失败 / 1 成功', example: 1, enum: [0, 1] })
  @IsOptional()
  @IsIn([0, 1])
  @Type(() => Number)
  status?: number
}

class QueryOperLogDto extends PagerDto {
  @ApiPropertyOptional({ description: '操作人用户名模糊过滤', example: 'admin' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  username?: string

  @ApiPropertyOptional({ description: '模块名模糊过滤', example: '用户管理' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  module?: string
}

@ApiTags('日志管理')
@ApiBearerAuth('jwt')
@Controller('logs')
export class LogController {
  constructor(private readonly logService: LogService) {}

  @ApiOperation({ summary: '登录日志分页列表' })
  @ApiOkResponse({ description: '登录日志分页', type: LoginLogEntity })
  @Perms('system:log:login')
  @Get('login')
  listLoginLog(@Query() query: QueryLoginLogDto) {
    return this.logService.listLoginLog(query)
  }

  @ApiOperation({ summary: '操作日志分页列表' })
  @ApiOkResponse({ description: '操作日志分页', type: OperLogEntity })
  @Perms('system:log:oper')
  @Get('oper')
  listOperLog(@Query() query: QueryOperLogDto) {
    return this.logService.listOperLog(query)
  }
}
