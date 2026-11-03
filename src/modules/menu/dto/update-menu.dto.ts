import { PartialType } from '@nestjs/mapped-types'
import { CreateMenuDto } from './create-menu.dto'

/** 更新时所有字段均可选 */
export class UpdateMenuDto extends PartialType(CreateMenuDto) {}
