import { PartialType } from "@nestjs/mapped-types";
import { CreateUserDto } from "./create-user.dto";

/** 更新时所有字段均可选 */
export class UpdateUserDto extends PartialType(CreateUserDto) {}
