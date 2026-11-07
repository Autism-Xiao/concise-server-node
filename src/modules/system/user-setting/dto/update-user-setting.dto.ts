import { ApiProperty } from '@nestjs/swagger'
import { IsObject } from 'class-validator'

/**
 * 保存当前用户的界面设置
 *
 * 用宽松的 `@IsObject()` 而不是逐字段 DTO：设置项会随前端迭代增删，
 * 逐字段写会让每次加开关都要发后端版本。真正的白名单/值域校验在
 * `user-setting.util.ts` 里做（只认识的键才落库）。
 */
export class UpdateUserSettingDto {
  @ApiProperty({
    description: '设置对象（白名单键：fontSize / themeColor / customColor / grayscale / colorWeak / sidebarVariant / layout / direction）',
    example: { fontSize: 'default', themeColor: 'mint' }
  })
  @IsObject({ message: 'settings 必须是对象' })
  settings: Record<string, unknown>
}
