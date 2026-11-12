import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { ArrayMinSize, IsArray, IsDateString, IsEmail, IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator'

export class CreateUserDto {
  @ApiProperty({ description: '登录账号（唯一，3~100 位；密码算法绑定账号，创建后不可改）', example: 'zhangsan', minLength: 3, maxLength: 100 })
  @IsString()
  @Length(3, 100, { message: '用户名长度须在 3~100 位之间' })
  username: string

  @ApiProperty({ description: '真实姓名', example: '张三', maxLength: 100 })
  @IsString()
  @Length(1, 100)
  realname?: string

  @ApiProperty({ description: '密码（6~64 位明文，服务端哈希后入库）', example: '123456', minLength: 6, maxLength: 64 })
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

  @ApiPropertyOptional({ description: '角色 ID 列表（sys_role.id，32 位字符串）', example: ['f6817f48af4fb3af11b9e8bf182f618b'], type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  roleIds?: string[]

  @ApiPropertyOptional({
    description: '所属部门 ID 列表（sys_depart.id，按顺序写入 sys_user_depart，第一个为主部门），传空数组表示清空',
    example: ['dept_1', 'dept_2'],
    type: [String]
  })
  @IsOptional()
  @IsArray({ message: 'deptIds 必须是数组' })
  @IsString({ each: true, message: 'deptIds 元素必须是字符串' })
  deptIds?: string[]

  @ApiPropertyOptional({ description: '【已废弃，请用 deptIds】单个部门 ID，等价于 deptIds: [deptId]', example: 'dept_1', deprecated: true })
  @IsOptional()
  @IsString()
  deptId?: string

  @ApiPropertyOptional({
    description: '密码过期时间（ISO 8601 或 YYYY-MM-DD；空 = 不限制；过期后登录强制改密）',
    example: '2026-12-31'
  })
  @IsOptional()
  @IsDateString({}, { message: 'passwordExpireAt 须为合法日期' })
  passwordExpireAt?: string | null

  @ApiPropertyOptional({ description: '下次登录是否强制改密：1 是 / 0 否', example: 0, enum: [0, 1] })
  @IsOptional()
  @IsIn([0, 1])
  @Type(() => Number)
  mustChangePassword?: number

  @ApiPropertyOptional({
    description: '岗位 ID 列表（sys_position.id，写入 sys_user_post），传空数组表示清空',
    example: ['post_1'],
    type: [String]
  })
  @IsOptional()
  @IsArray({ message: 'postIds 必须是数组' })
  @IsString({ each: true, message: 'postIds 元素必须是字符串' })
  postIds?: string[]

  @ApiPropertyOptional({ description: '职级 ID（sys_level.id，单选，可空；传 null/不传表示不设置）', example: 'lvl_3' })
  @IsOptional()
  @IsString({ message: 'levelId 必须是字符串' })
  @MaxLength(32)
  levelId?: string | null
}
