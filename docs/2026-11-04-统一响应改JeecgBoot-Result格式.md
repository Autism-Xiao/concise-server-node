# 统一响应改用 JeecgBoot `Result` 格式

> 起因：对接方（JeecgBoot 前端 / 旧系统）给出的标准返回是
>
> ```json
> { "code": 0, "message": "", "result": "data:image/jpg;base64,...", "success": true, "timestamp": 1793768743245 }
> ```
>
> 而本项目原来是 `{ code: 0, data: ..., message: 'ok' }`——字段名不同（`data` vs `result`）、
> 缺少 `success` / `timestamp`、成功的 `message` 是 `'ok'` 而不是空串。
> 本轮把**全局包装层**改成与 JeecgBoot `Result<T>` 完全一致，业务代码零改动。

## 一、改了哪些文件

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `src/common/interfaces/api-result.interface.ts` | **新增** | 定义 `ApiResult<T>`：`code` / `message` / `result` / `success` / `timestamp` 五字段 |
| `src/common/interceptors/transform.interceptor.ts` | 修改 | 成功响应改为 `{ code: 0, message: '', result, success: true, timestamp }` |
| `src/common/filters/any-exception.filter.ts` | 修改 | 三个异常分支统一走 `fail()`，输出 `result: null` / `success: false` / `timestamp` |
| `src/common/exceptions/business.exception.ts` | 修改 | 仅注释说明新的响应形状（业务逻辑没变：HTTP 200 + 业务 code） |
| `src/main.ts` | 修改 | Swagger 文档描述里补充统一响应说明，避免看文档的人以为 `type` 就是整个响应体 |
| `test/app.e2e-spec.ts` | 修改 | 旧断言 `{ code, data, message }` 已失效，改为 `toMatchObject` + `timestamp` 类型断言 |
| `docs/2026-11-04-统一响应改JeecgBoot-Result格式.md` | 新增 | 本文档 |
| `docs/README.md` | 修改 | 索引登记 |

**数据库无变化**，纯返回层改造。

## 二、新格式一览

| 场景 | HTTP 状态 | 响应体 |
| --- | --- | --- |
| 成功（所有接口） | 200 | `{ code: 0, message: "", result: <数据>, success: true, timestamp: <ms> }` |
| 业务异常 `BusinessException` | **200** | `{ code: <业务码>, message: "<提示>", result: null, success: false, timestamp }` |
| 参数校验 / 401 / 403 / 404 | 对应状态码 | `{ code: <同 HTTP 状态>, message: "<提示>", result: null, success: false, timestamp }` |
| 未捕获异常 | 500 | `{ code: 500, message: "Internal server error", result: null, success: false, timestamp }` |
| CSV 导出 / 文件流 | 200 | **不包装**，直接返回二进制流（`Content-Type: text/csv`） |

实测样例：

```jsonc
// 成功：GET /api/auth/captcha
{ "code": 0, "message": "", "result": { "captchaId": "0909a768-...", "svg": "<svg ...>" }, "success": true, "timestamp": 1793769358501 }

// 业务异常：PUT /api/users/:id/depts 传了不存在的部门（HTTP 仍是 200）
{ "code": 400, "message": "部门不存在或已删除：nope", "result": null, "success": false, "timestamp": 1793769368665 }

// 鉴权失败：未带 token
{ "code": 401, "message": "Unauthorized", "result": null, "success": false, "timestamp": 1793769358501 }
```

## 三、每个东西是干什么的

### 1. `ApiResult<T>` 类型（新增）

唯一的结构定义处。以前 `Response<T>` 定义在拦截器文件里，异常过滤器只能自己手写对象；抽成独立接口后，
拦截器和过滤器共用同一份类型，字段增减只需要改一处。

- `code`：不是 HTTP 状态码。成功恒 `0`；失败是业务码（如 `503` 验证码服务不可用）或 HTTP 状态码（`400/401/403/404/500`）。
- `message`：成功为空串 `''`；失败是可直接展示给用户的文案。
- `result`：业务数据；无返回值的接口（如某些 `DELETE`）为 `null`。
- `success`：冗余判断位，等价 `code === 0`，方便 `if (res.success)`，也方便表格列直接渲染。
- `timestamp`：服务端包装时生成的毫秒时间戳，排查前端缓存、跨时区、顺序问题时有用。

### 2. `TransformInterceptor`（改）

所有走 Nest 正常返回路径的接口都会经过这里。文件流不包装——`StreamableFile` / `Buffer` 直接透传，
否则 CSV 会被 JSON 包住，下载下来就是一段 JSON 文本。

用 `satisfies ApiResult<T>` 而不是 `as ApiResult<T>`：既能保证字段齐全、类型正确，又不会把对象字面量
断言成联合类型而丢掉下面的类型检查（写错字段名会直接报错）。

### 3. `AllExceptionsFilter`（改）

三个分支（业务异常 / `HttpException` / 未知异常）现在都调用同一个 `fail(code, message)`，
避免出现「某个分支忘了加 `success`」的情况——那种 bug 前端最难查：HTTP 是通的，但 `success` 是 `undefined`。

### 4. `BusinessException`（仅注释）

行为完全没变：**HTTP 200 + 业务 code**。这样前端 axios 不会走 `catch` 分支，统一在 `then` 里按
`success` / `code` 处理，避免「业务提示弹两个框」的老问题。

### 5. `main.ts` 的 Swagger 描述（改）

`@ApiOkResponse({ type: XxxEntity })` 描述的是 `result` 里的内容，不是整个响应体。文档里写明这点，
联调时不会再有人问「为什么 Swagger 显示的是数组，实际返回外面还套了一层」。

## 四、完整代码

### 4.1 `src/common/interfaces/api-result.interface.ts`（新增）

```ts
/**
 * 统一响应结构（对齐 JeecgBoot 的 Result<T>）
 *
 * 成功：{ code: 0, message: '', result: <业务数据>, success: true, timestamp: 1793768743245 }
 * 失败：{ code: <非 0>, message: '<可直接提示的文案>', result: null, success: false, timestamp: ... }
 *
 * - code 不是 HTTP 状态码：成功恒为 0；业务异常用业务码（如 503），参数/鉴权异常用 HTTP 状态码
 * - success 是冗余的快速判断位，等价于 code === 0，方便前端 `if (res.success)` 直接判断
 * - timestamp 由服务端在包装时生成（毫秒），用于排查前端缓存/时序问题
 */
export interface ApiResult<T = unknown> {
  /** 成功固定 0；失败为业务错误码或 HTTP 状态码 */
  code: number
  /** 成功为空串，失败为可直接展示的错误信息 */
  message: string
  /** 业务数据，失败时为 null */
  result: T | null
  /** 是否成功，等价于 code === 0 */
  success: boolean
  /** 服务端响应时间戳（毫秒） */
  timestamp: number
}
```

### 4.2 `src/common/interceptors/transform.interceptor.ts`（改）

```ts
import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor, StreamableFile } from '@nestjs/common'
import type { Observable } from 'rxjs'
import { map } from 'rxjs/operators'

import type { ApiResult } from '../interfaces/api-result.interface'

/**
 * 统一响应包装（对齐 JeecgBoot Result<T>）
 * 成功时固定返回：{ code: 0, message: '', result: <数据>, success: true, timestamp }
 * 文件流（StreamableFile / Buffer）为二进制下载，不参与包装
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResult<T> | T> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<ApiResult<T> | T> {
    return next.handle().pipe(
      map(data => {
        // 文件流等特殊响应不做包装
        if (data instanceof StreamableFile || Buffer.isBuffer(data)) {
          return data
        }
        return {
          code: 0,
          message: '',
          result: data ?? null,
          success: true,
          timestamp: Date.now()
        } satisfies ApiResult<T>
      })
    )
  }
}
```

### 4.3 `src/common/filters/any-exception.filter.ts`（改）

```ts
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common'
import type { Response } from 'express'

import { winstonLogger } from '../../shared/logger/winston.logger'
import { BusinessException } from '../exceptions/business.exception'
import type { ApiResult } from '../interfaces/api-result.interface'

interface ExceptionResponse {
  message: string | string[]
  code?: number
}

/** 组装失败响应（result 恒为 null，success 恒为 false） */
function fail(code: number, message: string): ApiResult<null> {
  return { code, message, result: null, success: false, timestamp: Date.now() }
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest<{ method: string; url: string }>()

    if (exception instanceof BusinessException) {
      // 业务异常：HTTP 200，用 code 区分
      return response.status(HttpStatus.OK).json(fail(exception.getBizCode(), exception.message))
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      const res = exception.getResponse()
      const raw = typeof res === 'string' ? res : (res as ExceptionResponse).message
      // class-validator 的错误是数组，只取第一条
      const message = Array.isArray(raw) ? raw[0] : raw
      return response.status(status).json(fail(status, message ?? exception.message))
    }

    // 未知异常：记录完整堆栈，对外只暴露通用提示
    winstonLogger.error(`${request.method} ${request.url} -> ${exception instanceof Error ? exception.stack : String(exception)}`)
    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(fail(HttpStatus.INTERNAL_SERVER_ERROR, 'Internal server error'))
  }
}
```

### 4.4 `src/common/exceptions/business.exception.ts`（仅注释变化）

```ts
import { HttpException, HttpStatus } from '@nestjs/common'

/**
 * 业务异常：HTTP 状态返回 200，通过响应体中的 code 区分错误。
 * 响应体为标准 Result：{ code: <bizCode>, message, result: null, success: false, timestamp }
 * 前端统一拦截：success === false（或 code !== 0）时提示 message。
 */
export class BusinessException extends HttpException {
  private readonly bizCode: number

  constructor(
    /** 业务错误信息，直接展示给用户 */
    message: string,
    /** 业务错误码，0 表示成功 */
    bizCode: number = HttpStatus.BAD_REQUEST
  ) {
    super({ message, code: bizCode }, HttpStatus.OK)
    this.bizCode = bizCode
  }

  getBizCode(): number {
    return this.bizCode
  }
}
```

### 4.5 `src/main.ts`（Swagger 描述部分）

```ts
  // Swagger 接口文档：/api/docs 在线查看，/api/docs-json 导出 OpenAPI 规范
  const swaggerConfig = new DocumentBuilder()
    .setTitle('concise-server-node API')
    .setDescription(
      [
        '中后台服务接口文档',
        '',
        '**统一响应结构（对齐 JeecgBoot Result）**',
        '',
        '```json',
        '{ "code": 0, "message": "", "result": {}, "success": true, "timestamp": 1793768743245 }',
        '```',
        '',
        '- 成功：`code = 0`、`message = ""`、`success = true`，业务数据在 `result`',
        '- 业务异常：HTTP 200，`code` 为业务码、`success = false`、`result = null`',
        '- 参数/鉴权异常：`code` 等于 HTTP 状态码（400 / 401 / 403 …）',
        '- 各接口 `@ApiOkResponse` 的 `type` 只描述 `result` 内部的业务数据，不含外层包装',
        '- 文件下载（CSV 导出）为二进制流，不参与包装'
      ].join('\n')
    )
    .setVersion('0.1')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'jwt')
    .build()
```

### 4.6 `test/app.e2e-spec.ts`（改断言）

```ts
import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { App } from 'supertest/types'
import { AppModule } from './../src/app.module'

describe('AppController (e2e)', () => {
  let app: INestApplication<App>

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule]
    }).compile()

    app = moduleFixture.createNestApplication()
    await app.init()
  })

  it('/ (GET)', async () => {
    const res = await request(app.getHttpServer()).get('/').expect(200)
    // 统一响应为标准 Result：{ code, message, result, success, timestamp }
    expect(res.body).toMatchObject({ code: 0, message: '', result: 'Hello World!', success: true })
    expect(typeof res.body.timestamp).toBe('number')
  })

  afterEach(async () => {
    await app.close()
  })
})
```

## 五、遇到的坑

1. **`StreamableFile` 判断必须在包装之前**。CSV 导出返回 `StreamableFile`，如果先包装再返回，
   `Content-Type` 虽然是 `text/csv`，但内容是 `{"code":0,...}`，Excel 打不开。现在判断放在 `map` 第一行。
2. **异常过滤器三个分支都要补字段**。只改业务异常分支，参数校验返回的 `success` 就是 `undefined`，
   前端 `if (!res.success)` 会把校验错误当成功处理。抽 `fail()` 就是为了根治这个。
3. **`timestamp` 让 e2e 断言不能用对象全等**。原来 `expect({ code, data, message })` 写法必须换成
   `toMatchObject`，再单独断言 `typeof timestamp === 'number'`。
4. **`result` 允许 `null`，类型要写 `T | null`**。`DELETE` 类接口 controller 返回 `void`，
   `data ?? null` 得到 `null`；若类型写成 `T`，`tsc` 会在 `satisfies` 处报错。
5. **成功 `message` 用空串而不是 `'ok'`**。JeecgBoot 前端有的组件会把 `message` 直接丢进提示框，
   成功时弹一个 "ok" 很突兀。空串等于「没有提示」，语义更干净。
6. **业务异常仍然 HTTP 200**。这次只改响应体，不改状态码；如果把 `BusinessException` 改成真 503，
   前端 axios 会走 `error` 分支，之前写好的统一提示逻辑全部失效。
7. **`@ApiOkResponse` 的 `type` 语义变了**。它现在描述的是 `result` 内部结构，
   所以 Swagger UI 里尝试的「示例值」看起来比实际响应少一层，这是预期的。

## 六、影响面与前端迁移

**所有 65 个接口的响应外壳都变了**，但内部业务数据一个字节都没动。

| 旧写法（前端 / 脚本） | 新写法 |
| --- | --- |
| `res.data` | `res.result` |
| `if (res.code === 0)` | 可继续用，或 `if (res.success)` |
| `res.message === 'ok'` 判断成功 | 不要再靠 message，成功时是 `''` |
| 业务异常判断 `res.code !== 0` | 不变；同时 `success === false`、`result === null` |

不受影响的部分：

- CSV 导出（`/api/logs/login/export`、`/api/logs/oper/export`）——仍是文件流
- 上传后的静态资源访问（`/upload/...`）——不经过 Nest 拦截器
- 请求入参（DTO）——完全没动

Postman 集合里的 `pm.response.json().data` 需要批量替换成 `.result`，断言 `code === 0` 的可保留。

## 七、怎么扩展 / 使用

1. **新写接口不用管包装**：controller 直接 `return 业务数据`，自动进 `result`。
   需要返回 `null` 语义的（如无内容）也直接 `return null`。
2. **需要分页**：`result` 就是原来的分页对象 `{ items, total, page, pageSize }`，无需额外处理。
3. **需要自定义 HTTP 头或非 JSON 响应**：用 `@Res({ passthrough: false })` 手动 `res.json()`/`res.send()`，
   此时拦截器的包装结果会被丢弃——这类接口要自己按 `ApiResult` 组装（本项目目前只有 CSV 导出走这条路，
   且它返回 `StreamableFile`，不需要 JSON）。
4. **以后想把成功码改成 200**：只改 `transform.interceptor.ts` 的 `code` 和 `fail()` 的语义即可，
   但前端所有 `code === 0` 判断要同步改；更稳的做法是保留 `code: 0`，前端只认 `success`。
5. **想加链路追踪**：在 `timestamp` 旁边加 `traceId` 即可（从 request 头或
   `cls-hooked`/`nestjs-cls` 取），拦截器和过滤器都加同一个字段就能全覆盖。
