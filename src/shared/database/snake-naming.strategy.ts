import { DefaultNamingStrategy } from 'typeorm'
import type { NamingStrategyInterface } from 'typeorm'

/**
 * 全局 snake_case 命名策略（对齐 JeecgBoot 表结构风格）
 * TypeORM 1.x 已移除内置 SnakeNamingStrategy，此处按 0.3.x 同名策略自行实现：
 * 实体驼峰属性自动映射下划线列名（createdAt→created_at、deptId→dept_id、workNo→work_no）
 * 显式指定的 @Column({ name }) / @Entity() 表名不受影响
 */
export class SnakeNamingStrategy extends DefaultNamingStrategy implements NamingStrategyInterface {
  tableName(className: string, customName?: string): string {
    return customName ?? snakeCase(className)
  }

  columnName(propertyName: string, customName?: string, embeddedPrefixes: string[] = []): string {
    return snakeCase(embeddedPrefixes.concat('').join('_')) + snakeCase(customName ?? propertyName)
  }

  relationColumnName(propertyName: string, columnName: string): string {
    return snakeCase(propertyName + '_' + columnName)
  }

  joinColumnName(relationName: string, referencedColumnName: string): string {
    return snakeCase(relationName + '_' + referencedColumnName)
  }

  joinTableName(firstTableName: string, secondTableName: string, firstPropertyName: string, _secondPropertyName?: string): string {
    return snakeCase(firstTableName + '_' + firstPropertyName.replace(/\./gi, '_') + '_' + secondTableName)
  }

  joinTableColumnName(tableName: string, propertyName: string, columnName?: string): string {
    return snakeCase(tableName + '_' + (columnName ?? propertyName))
  }

  eagerJoinRelationAlias(alias: string, path: string): string {
    return alias + '__' + path.replace('.', '_')
  }
}

/** 驼峰转下划线（与 TypeORM 0.3 StringUtil.snakeCase 一致） */
function snakeCase(str: string, char = '_'): string {
  return str
    .replace(/(?<=[a-z0-9])[A-Z]/g, match => char + match.toLowerCase())
    .replace(/(?<=[A-Z])[A-Z][a-z]/g, match => char + match.toLowerCase())
    .toLowerCase()
}
