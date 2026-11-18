import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { UserModule } from '../../user/user.module'
import { TaskEntity } from './entities/task.entity'
import { TaskV1Controller } from './task.v1.controller'
import { TaskService } from './task.service'

@Module({
  // UserModule 提供 UserService：列表把 assignee_id 翻译成姓名、写入前校验负责人是否存在
  imports: [TypeOrmModule.forFeature([TaskEntity]), UserModule],
  controllers: [TaskV1Controller],
  providers: [TaskService],
  exports: [TaskService]
})
export class TaskModule {}
