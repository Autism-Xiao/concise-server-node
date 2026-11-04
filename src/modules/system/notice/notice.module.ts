import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { SysAnnouncementEntity } from './entities/sys-announcement.entity'
import { NoticeV1Controller } from './notice.v1.controller'
import { NoticeService } from './notice.service'

@Module({
  imports: [TypeOrmModule.forFeature([SysAnnouncementEntity])],
  controllers: [NoticeV1Controller],
  providers: [NoticeService],
  exports: [NoticeService]
})
export class NoticeModule {}
