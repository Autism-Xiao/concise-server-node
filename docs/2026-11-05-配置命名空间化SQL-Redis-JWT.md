# 配置命名空间化：SQL / Redis / JWT / 验证码提取到独立配置

日期：2026-11-05

## 需求

把散落在各处的 Redis、JWT（顺带验证码）配置提取到独立配置文件，统一成主流写法。

改造前只有 `app` 与 `database`（SQL）是 `registerAs` 命名空间，Redis / JWT / CAPTCHA 全是**裸字符串键**：

| 配置 | 改造前读取位置 | 问题 |
| --- | --- | --- |
| Redis | `shared/redis/redis.service.ts` 内 5 行 `get<string>('REDIS_*')` | 键名靠字符串拼、`enabled` 要与 `'true'` 比、`Number()` 转换散在 service |
| JWT | `auth.module.ts`、`auth.service.ts`（2 处）、`jwt.strategy.ts` 各读一次 | 4 个键在 3 个文件重复读；`expiresIn` 每个点都要 `as StringValue` |
| CAPTCHA | `auth.controller.ts`、`auth.v1.controller.ts` 各读一次 `CAPTCHA_DEBUG` | 同一个开关两处实现，容易只改一处 |

## 做法（对齐 NestJS 官方 configuration namespaces）

链路：`.env` → `xxx.config.ts` 的 `registerAs` 工厂（类型转换）→ `ConfigModule.forRoot({ load, validate })` → 业务侧 `@Inject(xxxConfig.KEY)` 注入整块。

### 改动文件

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `src/config/redis.config.ts` | 新增 | `registerAs('redis')`：`enabled`/`host`/`port`/`password`/`db`，布尔与数字在此转好，空密码转 `undefined` |
| `src/config/jwt.config.ts` | 新增 | `registerAs('jwt')`：`secret`/`expiresIn`/`refreshSecret`/`refreshExpiresIn`；`expiresIn` 在此一次性断言为 `StringValue` |
| `src/config/captcha.config.ts` | 新增 | `registerAs('captcha')`：`enabled`/`debug`；默认值保持原行为（`enabled` 默认 false） |
| `src/config/env.validation.ts` | 新增 | `validateEnv()`：class-validator + class-transformer，启动期校验必填与格式，失败直接抛错阻断启动 |
| `src/config/index.ts` | 修改 | `configs` 增加三个命名空间，并导出类型 `JwtConfig`/`RedisConfig`/`CaptchaConfig` |
| `src/app.module.ts` | 修改 | `ConfigModule.forRoot({ ..., validate: validateEnv })` |
| `src/shared/redis/redis.service.ts` | 修改 | 构造参数改 `@Inject(redisConfig.KEY) config: RedisConfig`，去掉全部字符串键与类型转换 |
| `src/modules/auth/auth.module.ts` | 修改 | `JwtModule.registerAsync({ inject: [jwtConfig.KEY] })`，删掉 `ConfigService` + `StringValue` 强转 |
| `src/modules/auth/strategies/jwt.strategy.ts` | 修改 | `secretOrKey: jwt.secret`（注入命名空间），不再 `as string` |
| `src/modules/auth/services/auth.service.ts` | 修改 | 注入 `jwt` + `captcha` 两块；`issueTokens` 一次解构 4 个字段；验证码开关读 `captcha.enabled` |
| `src/modules/auth/controllers/auth.controller.ts` | 修改 | 注入 `captchaConfig.KEY`，`debug` 直接取布尔 |
| `src/modules/auth/controllers/auth.v1.controller.ts` | 修改 | 同上 |
| `.env.example` | 修改 | 只补注释、标出必填与默认值；顺带修掉笔误 `REDIS_JS` → `REDIS_DB`（原来照模板配了也不生效） |

**`.env` 里的键名一个没改**，所以不存在迁移成本。

### 每个文件是干什么的

- `redis.config.ts` / `jwt.config.ts` / `captcha.config.ts`：一域一文件，只读 `process.env`（经 `global/env.ts` 的 `env/envNumber/envBoolean` 转类型），**不注入任何 service**，避免循环依赖。`registerAs` 产出的对象同时是一个 DI token，`ConfigModule` 全局注册后任何地方 `@Inject(jwtConfig.KEY)` 都能拿到整块。
- `env.validation.ts`：只校验「存在 + 格式」，不负责转换。缺 `JWT_SECRET` / `JWT_REFRESH_SECRET`、密钥短于 16 位、`PORT`/`DB_PORT`/`REDIS_PORT`/`REDIS_DB` 非数字、`*_ENABLED` 不是布尔写法、`JWT_EXPIRES_IN` 不是 `2h`/`7d` 这类，全部在 `bootstrap` 阶段抛错。
- `index.ts`：配置注册表 + 导出类型，新增配置只改这一处。

### 为什么用 `@Inject(xxxConfig.KEY)` 而不是 `configService.get('jwt.secret')`

1. 字段名编译期可查，写错 `secrect` 直接 tsc 报错；字符串键写错只会静默 `undefined`。
2. 类型自动收窄，不需要 `infer: true`，也不需要 `as`。
3. 单测可直接构造配置对象注入，不必 mock `ConfigService`。

## 验证

1. `npx tsc --noEmit` 通过；eslint 通过。
2. 全量 grep 确认 `src` 下已无 `get('JWT_*/REDIS_*/CAPTCHA_*')` 裸读取。
3. 启动期校验实测（`tsc` 编译后 `node dist/main.js`）：
   - `JWT_SECRET=abc` → `环境变量校验未通过，请检查 .env：  - JWT_SECRET 长度至少 16 位`，进程退出；
   - `PORT=abc` → `  - PORT 必须是数字`，进程退出。
4. 正常启动 + 鉴权链路：用 `.env` 里的 `JWT_SECRET` 自签 admin token 打 `GET /api/v1/auth/permissions` → `code=0, roles=["admin"], permissions=1, menus=6`；伪造 token 打 `/api/v1/users` → 401。说明 JWT 命名空间确实被 `JwtStrategy` / `JwtModule` 用上了，不是"能启动但密钥不生效"。

## 坑

1. **Windows 下 `JWT_SECRET=` 空值测不出校验失败**：Windows 设置空环境变量等价于删除该变量，dotenv 会从 `.env` 补回真值。要验证必填，用「短值」而不是「空值」。
2. **`infer: true` 只对点路径生效**：`get('jwt.secret', { infer: true })` 有类型，`get('jwt')` 必须显式给泛型。本项目统一走 `@Inject(KEY)`，两种都不用了。
3. **`ConfigModule` 合并顺序是 `{ ...env文件, ...process.env }`**（`override: false` 时），即**进程环境变量优先于 `.env`**；`envFilePath: ['.env.local', '.env']` 里前者优先。排查"配置没生效"先确认是不是被外层环境变量盖住了。
4. **`expiresIn` 的类型是 ms 包的 `StringValue`**，在配置层断言一次即可，别在调用点写 `as`。
5. **`validate` 抛错 = 进程起不来**，这是有意的；要临时跑测试可以 `REDIS_ENABLED=false CAPTCHA_ENABLED=false node dist/main.js` 覆盖，不必改 `.env`。
6. **`nest start` 会先删 `dist`（`nest-cli.json` 的 `deleteOutDir`），本机安全钩子会拦**。验证时用 `npx tsc -p tsconfig.build.json --incremental false` 直接编译进 `dist`（tsc 不删目录）再 `node dist/main.js`。
7. **别用 `dist-doc` / 别的输出目录跑服务**：`database.config.ts` 的 `entities` 是写死的 `dist/modules/**/*.entity.js`，服务代码在 `dist-doc`、实体在 `dist`，TypeORM 会报 `No metadata for "UserEntity" was found`。上一轮记录的「定时任务初始化失败：No metadata for SysQuartzJobEntity」就是这个原因造成的假报错，用正式 `dist` 启动时日志是 `定时任务已加载 0 个`，功能正常。
8. **控制器里属性名别和路由方法撞**：`private readonly captcha` 与 `captcha()` 方法同名会直接编译失败，这里用了 `captchaCfg`。

## 如何扩展

新增一类配置（例如邮件 / OSS）：

1. 建 `src/config/mail.config.ts`，`registerAs('mail', () => ({...}))` + `export type MailConfig = ConfigType<typeof mailConfig>`；
2. 在 `src/config/index.ts` 的 `configs` 与导出里各加一行；
3. 在 `env.validation.ts` 的 `EnvironmentVariables` 里声明新增的键（必填不加 `@IsOptional`）；
4. 用 `constructor(@Inject(mailConfig.KEY) private readonly mail: MailConfig)` 注入，**不要**再写 `configService.get('MAIL_HOST')`。

新增环境变量时，`.env.example` 与 `env.validation.ts` 两处必须同步，否则模板照抄会启动失败（这是有意的强约束）。
