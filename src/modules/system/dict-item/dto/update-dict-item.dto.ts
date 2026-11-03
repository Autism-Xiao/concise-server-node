import { PartialType } from '@nestjs/swagger'

import { CreateDictItemDto } from './create-dict-item.dto'

export class UpdateDictItemDto extends PartialType(CreateDictItemDto) {}
