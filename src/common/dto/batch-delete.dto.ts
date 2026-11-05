import { ApiProperty } from '@nestjs/swagger'
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsString } from 'class-validator'

import { BATCH_DELETE_MAX } from '../../helper/crud/batch-delete'

/** 批量删除入参：所有资源共用，前端只需发 { ids } */
export class BatchDeleteDto {
  @ApiProperty({ description: `待删除的 ID 列表，单次最多 ${BATCH_DELETE_MAX} 条`, type: [String], example: ['1', '2'] })
  @IsArray({ message: 'ids 必须是数组' })
  @ArrayNotEmpty({ message: '请选择要操作的数据' })
  @ArrayMaxSize(BATCH_DELETE_MAX, { message: `单次最多操作 ${BATCH_DELETE_MAX} 条` })
  @IsString({ each: true, message: '每个 id 必须是字符串' })
  ids: string[]
}
