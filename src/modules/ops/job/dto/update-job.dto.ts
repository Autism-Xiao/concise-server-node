import { PartialType } from '@nestjs/swagger'

import { CreateJobDto } from './create-job.dto'

/** 更新定时任务：字段全部可选 */
export class UpdateJobDto extends PartialType(CreateJobDto) {}
