import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { RoleModule } from '../role/role.module'
import { OnlineModule } from '../ops/online/online.module'
import { DeptEntity } from '../system/dept/entities/dept.entity'
import { PostEntity } from '../system/post/entities/post.entity'
import { LevelEntity } from '../system/level/entities/level.entity'
import { UserWatermarkEntity } from '../system/watermark/entities/user-watermark.entity'
import { WatermarkSettingEntity } from '../system/watermark/entities/watermark-setting.entity'
import { UserSettingModule } from '../system/user-setting/user-setting.module'
import { SystemConfigModule } from '../system/config/config.module'
import { OpenApiModule } from '../openapi/open.module'
import { UserEntity } from './entities/user.entity'
import { SuperviseDeptEntity } from './entities/supervise-dept.entity'
import { UserV1Controller } from './user.v1.controller'
import { UserService } from './user.service'

@Module({
  // DeptEntity 需在本模块 forFeature 注册，才能在此注入 Repository（跨模块注入不生效）；
  // 水印两张表同理：列表要一并返回"是否带水印"，直接读仓库比跨模块调服务更省一次绕行；
  // OnlineModule 提供 kickUser（冻结/重置密码联动踢下线）；
  // UserSettingModule 提供 ensure()：建号时同步落一行界面设置（本身不反向依赖 UserModule，无循环）
  imports: [
    TypeOrmModule.forFeature([UserEntity, DeptEntity, SuperviseDeptEntity, PostEntity, LevelEntity, UserWatermarkEntity, WatermarkSettingEntity]),
    RoleModule,
    OnlineModule,
    UserSettingModule,
    // 密码策略来自 sys_config（长度/复杂度/有效期），不引会拿不到 SystemConfigService
    SystemConfigModule,
    // 用户创建/删除要派发 webhook 事件（开放平台的订阅方收通知）
    OpenApiModule
  ],
  controllers: [UserV1Controller],
  providers: [UserService],
  exports: [UserService]
})
export class UserModule {}
