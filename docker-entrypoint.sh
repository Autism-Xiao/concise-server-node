#!/bin/sh
# 容器入口：可选执行迁移 → 启动应用
# RUN_MIGRATIONS=true  时启动前先跑 typeorm migration:run（默认 false，多副本部署只让一个实例跑）
set -e

if [ "${RUN_MIGRATIONS}" = "true" ]; then
  echo "[entrypoint] 执行数据库迁移..."
  npx typeorm migration:run -d dist/shared/database/data-source.js
  echo "[entrypoint] 迁移完成"
fi

exec node dist/main.js
