import "dotenv/config";

import { DataSource } from "typeorm";

import { databaseConfig } from "../../config/database.config";

/**
 * 供 TypeORM 迁移 CLI 使用的数据源（不参与 Nest 依赖注入）
 * 用法：pnpm run migration:generate / migration:run / migration:revert
 */
export default new DataSource(databaseConfig() as import("typeorm").DataSourceOptions);
