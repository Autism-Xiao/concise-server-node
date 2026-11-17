import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString, Length, Matches } from 'class-validator'

/**
 * 自助开通租户
 *
 * 只允许填基础信息：套餐固定 standard、状态固定正常、开通时间由服务端写，
 * 额度/资格完全由后端按 VIP 状态判定，前端传什么都不影响。
 */
export class ApplyTenantDto {
  @ApiProperty({ description: '租户（团队）名称', example: '云启科技' })
  @IsString()
  @Length(1, 100)
  name: string

  @ApiProperty({ description: '租户编码（唯一，字母数字下划线短横线）', example: 'yunqi' })
  @IsString()
  @Length(2, 64)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: '租户编码只能包含字母、数字、下划线和短横线' })
  code: string

  @ApiPropertyOptional({ description: '联系人', example: '张三' })
  @IsOptional()
  @IsString()
  @Length(0, 50)
  contact?: string

  @ApiPropertyOptional({ description: '联系电话', example: '13800000000' })
  @IsOptional()
  @IsString()
  @Length(0, 30)
  phone?: string

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  @Length(0, 255)
  remark?: string
}
