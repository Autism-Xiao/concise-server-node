# 项目长期记忆：concise-server-node

## 用户强规则（每次必须遵守）

- **每轮生成/修改代码后，必须在 `docs/` 下新建一个 `.md` 变更说明文档**（命名 `YYYY-MM-DD-主题.md`），内容包含：改了哪些文件（表格：文件/类型/说明）、每个东西是干什么的、遇到的坑、怎么扩展/使用。完成后随代码一起提交推送。

## 项目约定

- NestJS 12 CJS + Jest + oxlint；TypeORM 1.1 + MySQL 8.4（本机服务 `MySQL84`，root/123456，库 `concise_server`）
- 参照 E:\project\demo\nest-admin 演进为中后台架构
- 统一响应 `{ code, data, message }`；业务异常 HTTP 200 + code 区分；全局 ValidationPipe（transform + whitelist）
- 泛型需 `extends ObjectLiteral`；query 参数 DTO 加 `@Type(() => Number)`；运行命令需 `PATH="/d/projram/nodejs:$PATH"`（Node 24）
- 3000 端口被外部进程占用，本地测试用 `PORT=3457`
- 下一步：modules/auth（JWT 登录 + 守卫）
