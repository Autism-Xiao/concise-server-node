import { Module } from '@nestjs/common'

import { CodegenService } from './codegen.service'
import { CodegenV1Controller } from './codegen.v1.controller'

/** 代码生成器（把 scripts/gen-module.cjs 包成页面可操作的服务，无自有实体） */
@Module({
  controllers: [CodegenV1Controller],
  providers: [CodegenService]
})
export class CodegenModule {}
