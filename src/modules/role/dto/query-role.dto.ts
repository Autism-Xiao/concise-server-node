import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString } from 'class-validator'

export class QueryRoleDto {
  @ApiPropertyOptional({ description: '关键字，模糊匹配角色名称/角色编码', example: '管理' })
  @IsOptional()
  @IsString()
  keyword?: string
}
