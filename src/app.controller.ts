import { Controller, Get } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'

import { Public } from './common/decorators/public.decorator'
import { AppService } from './app.service'

@ApiTags('系统')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @ApiOperation({ summary: '健康检查（公开）' })
  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello()
  }
}
