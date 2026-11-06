import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsArray, IsOptional, IsString } from 'class-validator'

/** 恢复软删用户：账号恢复为空壳，可在本次请求顺带重绑角色/部门（全量覆盖语义） */
export class RestoreUserDto {
  @ApiPropertyOptional({ description: '恢复后绑定的角色 id（不传则不绑角色）', type: [String], required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roleIds?: string[]

  @ApiPropertyOptional({ description: '恢复后绑定的部门 id（不传则不绑部门）', type: [String], required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  deptIds?: string[]
}
