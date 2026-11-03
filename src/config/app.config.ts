import { registerAs } from "@nestjs/config";

export const appConfig = registerAs("app", () => ({
  /** 监听端口 */
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
  /** 全局路由前缀 */
  globalPrefix: process.env.API_PREFIX ?? "api",
}));
