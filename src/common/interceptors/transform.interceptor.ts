import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  StreamableFile,
} from "@nestjs/common";
import type { Observable } from "rxjs";
import { map } from "rxjs/operators";

/** 统一响应结构：code 为 0 表示成功 */
export interface Response<T = unknown> {
  code: number;
  data: T;
  message: string;
}

@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, Response<T> | T>
{
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<Response<T> | T> {
    return next.handle().pipe(
      map((data) => {
        // 文件流等特殊响应不做包装
        if (data instanceof StreamableFile || Buffer.isBuffer(data)) {
          return data;
        }
        return { code: 0, data: data ?? null, message: "ok" } as Response<T>;
      }),
    );
  }
}
