/**
 * 环境变量读取工具
 * 参照 nest-admin 的 global/env.ts，提供带类型转换与默认值的读取方式
 */

/** 读取字符串环境变量，可指定默认值 */
export function env(key: string, defaultValue = ""): string {
  return process.env[key] ?? defaultValue;
}

/** 读取数字环境变量，转换失败时返回默认值 */
export function envNumber(key: string, defaultValue = 0): number {
  const value = Number.parseInt(process.env[key] ?? "", 10);
  return Number.isNaN(value) ? defaultValue : value;
}

/** 读取布尔环境变量，接受 "true"/"1"/"on" 为真值 */
export function envBoolean(key: string, defaultValue = false): boolean {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  return ["true", "1", "on", "yes"].includes(value.toLowerCase());
}
