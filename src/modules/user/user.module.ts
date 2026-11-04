import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { RoleModule } from '../role/role.module'
import { DeptEntity } from '../system/dept/entities/dept.entity'
import { UserEntity } from './entities/user.entity'
import { UserV1Controller } from './user.v1.controller'
import { UserController } from './user.controller'
import { UserService } from './user.service'

@Module({
  // DeptEntity 需在本模块 forFeature 注册，才能在此注入 Repository（跨模块注入不生效）
  imports: [TypeOrmModule.forFeature([UserEntity, DeptEntity]), RoleModule],
  controllers: [UserController, UserV1Controller],
  providers: [UserService],
  exports: [UserService]
})
export class UserModule {}
