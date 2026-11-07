import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { LEGACY_ROUTES_ENABLED } from '../../../config/legacy-routes.config'
import { TaskEntity } from './entities/task.entity'
import { TaskController } from './task.controller'
import { TaskService } from './task.service'

@Module({
  imports: [TypeOrmModule.forFeature([TaskEntity])],
  // 旧版（无 /v1 前缀）控制器默认不注册，见 config/legacy-routes.config.ts；
  // 任务无独立 v1 控制器（前端无任务页，数据只被仪表盘 service 内部消费），旧路由纯兜底
  controllers: [...(LEGACY_ROUTES_ENABLED ? [TaskController] : [])],
  providers: [TaskService],
  exports: [TaskService]
})
export class TaskModule {}
