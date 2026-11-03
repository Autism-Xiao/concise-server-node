import { IsOptional, IsString, MaxLength } from "class-validator";

import { PagerDto } from "../../../common/dto/pager.dto";

/** 用户列表查询参数 */
export class QueryUserDto extends PagerDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  /** 模糊匹配用户名/昵称 */
  keyword?: string;

  @IsOptional()
  @IsString()
  status?: string;
}
