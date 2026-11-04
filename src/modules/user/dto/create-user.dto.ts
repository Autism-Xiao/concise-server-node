import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayMinSize, IsArray, IsDateString, IsEmail, IsIn, IsInt, IsOptional, IsString, Length, MaxLength, Min } from 'class-validator'

export class CreateUserDto {
  @ApiProperty({ description: '登录账号（唯一，3~100 位；密码算法绑定账号，创建后不可改）', example: 'zhangsan', minLength: 3, maxLength: 100 })
  @IsString()
  @Length(3, 100, { message: '用户名长度须在 3~100 位之间' })
  username: string

  @ApiProperty({ description: '真实姓名', example: '张三', maxLength: 100 })
  @IsString()
  @Length(1, 100)
  realname?: string

  @ApiProperty({ description: '密码（6~64 位明文，服务端生成盐并按 JeecgBoot 算法加密入库）', example: '123456', minLength: 6, maxLength: 64 })
  @IsString()
  @Length(6, 64, { message: '密码长度须在 6~64 位之间' })
  password: string

  @ApiPropertyOptional({ description: '头像 URL（可通过 /api/upload 上传获得）', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  avatar?: string

  @ApiPropertyOptional({ description: '性别：0 未知 / 1 男 / 2 女', example: 1, enum: [0, 1, 2] })
  @IsOptional()
  @IsIn([0, 1, 2])
  @Type(() => Number)
  sex?: number

  @ApiPropertyOptional({ description: '电话', example: '18611111111', maxLength: 45 })
  @IsOptional()
  @IsString()
  @MaxLength(45)
  phone?: string

  @ApiPropertyOptional({ description: '座机号', example: '010-88886666', maxLength: 45 })
  @IsOptional()
  @IsString()
  @MaxLength(45)
  telephone?: string

  @ApiPropertyOptional({ description: '邮箱', example: 'zhangsan@test.com', maxLength: 45 })
  @IsOptional()
  @IsEmail({}, { message: '邮箱格式不正确' })
  email?: string

  @ApiPropertyOptional({ description: '生日（YYYY-MM-DD）', example: '1990-01-01' })
  @IsOptional()
  @IsDateString({}, { message: '生日须为合法日期（YYYY-MM-DD）' })
  birthday?: string

  @ApiPropertyOptional({ description: '工号（唯一）', example: '00003', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  workNo?: string

  @ApiPropertyOptional({ description: '状态：1 正常 / 2 冻结', example: 1, enum: [1, 2] })
  @IsOptional()
  @IsIn([1, 2])
  status?: number

  @ApiPropertyOptional({ description: '角色 ID 列表', example: [1], type: [Number] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  @Type(() => Number)
  roleIds?: number[]

  @ApiPropertyOptional({ description: '所属部门 ID，0 为未分配', example: 1, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  deptId?: number
}
