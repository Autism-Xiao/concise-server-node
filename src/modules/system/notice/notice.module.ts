import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { UserEntity } from '../../user/entities/user.entity'
import { SysAnnouncementEntity } from './entities/sys-announcement.entity'
import { NoticeV1Controller } from './notice.v1.controller'
import { NoticeService } from './notice.service'

@Module({
  // UserEntity 供导入时把「指定用户」账号解析成 userIds，跨模块注入必须在本模块 forFeature 注册
  imports: [TypeOrmModule.forFeature([SysAnnouncementEntity, UserEntity])],
  controllers: [NoticeV1Controller],
  providers: [NoticeService],
  exports: [NoticeService]
})
export class NoticeModule {}
