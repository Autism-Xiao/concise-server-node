import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'

import { OperLog } from '../../common/decorators/oper-log.decorator'
import { Perms } from '../../common/decorators/perms.decorator'
import { RateLimit } from '../../common/decorators/rate-limit.decorator'
import { CodegenService } from './codegen.service'
import { GenerateCodegenDto, PreviewCodegenDto } from './dto/codegen.dto'

/**
 * 代码生成器 v1 接口
 *
 * 定位：把 scripts/gen-module.cjs 包成页面可操作的服务，脚本仍是唯一模板来源。
 * 安全：平台级菜单（scope=platform）+ tools:codegen:* 权限；生产环境默认禁用，
 * 只在后端服务器本机可用（写的是后端仓库文件），预览走临时目录零落盘。
 */
@ApiTags('代码生成器')
@ApiBearerAuth('jwt')
@Controller('v1/codegen')
export class CodegenV1Controller {
  constructor(private readonly codegenService: CodegenService) {}

  @ApiOperation({ summary: '生成器元数据', description: '字段类型 / 图标 / 菜单父节点 / 开关状态，需 tools:codegen:list' })
  @Perms('tools:codegen:list')
  @Get('meta')
  meta() {
    return this.codegenService.meta()
  }

  @ApiOperation({ summary: '可反查的已有数据表', description: '用于「从数据库表导入」，需 tools:codegen:list' })
  @Perms('tools:codegen:list')
  @Get('tables')
  tables() {
    return this.codegenService.tables()
  }

  @ApiOperation({ summary: '反查表结构为字段定义', description: '过滤系统列并识别单列唯一索引，需 tools:codegen:list' })
  @Perms('tools:codegen:list')
  @Get('tables/:table/fields')
  introspect(@Param('table') table: string) {
    return this.codegenService.introspect(table)
  }

  @ApiOperation({ summary: '预览生成产物', description: '生成器写进临时目录后读回内容，不落盘，需 tools:codegen:list' })
  @Perms('tools:codegen:list')
  @RateLimit({ limit: 20, window: 60, message: '预览过于频繁，请稍后再试' })
  @Post('preview')
  preview(@Body() dto: PreviewCodegenDto) {
    return this.codegenService.preview(dto)
  }

  @ApiOperation({ summary: '执行代码生成', description: '写盘 + 自动注册，需 tools:codegen:generate' })
  @Perms('tools:codegen:generate')
  @RateLimit({ limit: 5, window: 60, message: '生成操作过于频繁，请稍后再试' })
  @OperLog('代码生成')
  @Post('generate')
  generate(@Body() dto: GenerateCodegenDto) {
    return this.codegenService.generate(dto)
  }
}
