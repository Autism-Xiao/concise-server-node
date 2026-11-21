import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { FEATURE_FLAG_KEY, type FeatureFlagOptions } from '../decorators/feature-flag.decorator'
import { FeatureService } from '../../shared/feature/feature.service'

/**
 * 特性开关守卫（全局 APP_GUARD，位于 PermsGuard 之后）：
 * 端点标了 @FeatureFlag 且当前租户视角开关为关时整体拒绝（403）。
 * 平台视角（tenantId=null）走平台行判定，与租户回退链语义一致。
 */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly featureService: FeatureService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<FeatureFlagOptions | undefined>(FEATURE_FLAG_KEY, [context.getHandler(), context.getClass()])
    if (!options) {
      return true
    }
    if (await this.featureService.enabled(options.name)) {
      return true
    }
    throw new ForbiddenException(options.message ?? `功能「${options.name}」未开启`)
  }
}
