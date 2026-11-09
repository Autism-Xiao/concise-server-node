import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { LEGACY_ROUTES_ENABLED } from '../../../config/legacy-routes.config'
import { UserModule } from '../../user/user.module'
import { TaskEntity } from './entities/task.entity'
import { TaskController } from './task.controller'
import { TaskV1Controller } from './task.v1.controller'
import { TaskService } from './task.service'

@Module({
  // UserModule 提供 UserService：列表把 assignee_id 翻译成姓名、写入前校验负责人是否存在
  imports: [TypeOrmModule.forFeature([TaskEntity]), UserModule],
  // 旧版（无 /v1 前缀）控制器默认不注册，见 config/legacy-routes.config.ts
  controllers: [TaskV1Controller, ...(LEGACY_ROUTES_ENABLED ? [TaskController] : [])],
  providers: [TaskService],
  exports: [TaskService]
})
export class TaskModule {}
