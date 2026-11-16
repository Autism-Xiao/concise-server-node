import { Module } from '@nestjs/common'

import { SystemConfigModule } from '../../modules/system/config/config.module'
import { DbBackupService } from './db-backup.service'

/**
 * 数据库备份模块
 *
 * 被 ops/job 的 backupDbJob 调用（定时备份），也可由运维接口手动触发。
 * 依赖 SystemConfigModule 读保留份数与校验开关。
 */
@Module({
  imports: [SystemConfigModule],
  providers: [DbBackupService],
  exports: [DbBackupService]
})
export class BackupModule {}
