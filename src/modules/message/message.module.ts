import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { SysMessageEntity } from './entities/sys-message.entity'
import { SysMessageUserEntity } from './entities/sys-message-user.entity'
import { MessageService } from './message.service'
import { MessageV1Controller } from './message.v1.controller'

/** 站内信模块：sys_message + sys_message_user；notify() 供其他模块程序化投递 */
@Module({
  imports: [TypeOrmModule.forFeature([SysMessageEntity, SysMessageUserEntity])],
  controllers: [MessageV1Controller],
  providers: [MessageService],
  exports: [MessageService]
})
export class MessageModule {}
