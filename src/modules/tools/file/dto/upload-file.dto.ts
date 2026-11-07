import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, Min } from 'class-validator'

/** 同名文件冲突策略 */
export const UPLOAD_CONFLICT_MODES = ['rename', 'skip', 'overwrite'] as const
export type UploadConflictMode = (typeof UPLOAD_CONFLICT_MODES)[number]

export class UploadFileDto {
  @ApiPropertyOptional({ description: '上传到的目录 ID，0 或不传表示根目录', example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'parentId 必须是数字' })
  @Min(0, { message: 'parentId 不能为负数' })
  parentId?: number

  @ApiProperty({
    description: '同名冲突处理：rename=自动加 (1) 保留两份 / skip=跳过 / overwrite=覆盖原文件',
    enum: UPLOAD_CONFLICT_MODES,
    default: 'rename',
    required: false
  })
  @IsOptional()
  @IsIn(UPLOAD_CONFLICT_MODES as unknown as string[], { message: 'onConflict 取值不合法' })
  onConflict?: UploadConflictMode
}
