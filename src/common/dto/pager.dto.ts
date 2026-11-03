import { IsInt, IsOptional, Max, Min } from "class-validator";

/**
 * 通用分页参数基类
 * 业务列表 DTO 继承此类即可获得分页参数与校验
 */
export class PagerDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
