import { PartialType } from '@nestjs/mapped-types'
import { CreatePostDto } from './create-post.dto'

/** 更新时所有字段均可选 */
export class UpdatePostDto extends PartialType(CreatePostDto) {}
