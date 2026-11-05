import { Body, Controller, Delete, Get, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiExcludeController, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'

import { Perms } from '../../../common/decorators/perms.decorator'
import { StorageEntity } from './storage.entity'
import { DeleteStorageDto, QueryStorageDto } from './storage.dto'
import { StorageService } from './storage.service'

// 旧版无前缀接口：仅为向后兼容保留，不出现在 Swagger 文档中（文档只暴露 V1 + 系统分组）
@ApiExcludeController()
@ApiTags('工具 - 存储模块')
@ApiBearerAuth('jwt')
@Controller('storage')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @ApiOperation({ summary: '文件存储记录分页列表', description: '支持文件名/类型过滤' })
  @ApiOkResponse({ description: '存储记录分页', type: StorageEntity })
  @Perms('tools:storage:list')
  @Get('list')
  list(@Query() query: QueryStorageDto) {
    return this.storageService.list(query)
  }

  @ApiOperation({ summary: '批量删除文件记录（同时删除本地文件）' })
  @Perms('tools:storage:delete')
  @Delete()
  remove(@Body() dto: DeleteStorageDto) {
    return this.storageService.remove(dto.ids)
  }
}
