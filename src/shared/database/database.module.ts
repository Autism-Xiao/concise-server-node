import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import type { DataSourceOptions } from "typeorm";

import { databaseConfig } from "../../config/database.config";

/**
 * 数据库模块：全局注册 TypeORM 连接
 * 实体通过各业务模块 TypeOrmModule.forFeature 自动加载，无需手动维护列表
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        // 优先取已注册的 database 配置命名空间，兜底直接调用工厂
        return (
          configService.get<DataSourceOptions>("database") ??
          (databaseConfig() as DataSourceOptions)
        );
      },
    }),
  ],
})
export class DatabaseModule {}
