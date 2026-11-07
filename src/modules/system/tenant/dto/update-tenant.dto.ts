import { PartialType } from '@nestjs/swagger'

import { CreateTenantDto } from './create-tenant.dto'

/** 更新租户：所有字段可选，编码可改（唯一性由 Service 校验） */
export class UpdateTenantDto extends PartialType(CreateTenantDto) {}
