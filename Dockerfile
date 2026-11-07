# syntax=docker/dockerfile:1
# 多阶段构建：builder 装全量依赖并编译，runtime 只留生产依赖 + dist
# 构建镜像：docker build -t concise-server .
# 运行容器：docker run -p 3000:3000 --env-file .env.docker concise-server

# ── 阶段 1：构建 ────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# corepack 提供 pnpm（版本由 package.json packageManager 字段或 latest 决定）
RUN corepack enable

# 先只拷贝依赖清单，利用层缓存：源码变动不重装依赖
COPY package.json pnpm-lock.yaml ./

# HUSKY=0：容器内不是 git 仓库，prepare 钩子（husky）会失败
RUN HUSKY=0 pnpm install --frozen-lockfile

COPY tsconfig.json nest-cli.json ./
COPY src ./src

RUN pnpm build

# 裁掉 devDependencies，产出生产依赖树
RUN pnpm prune --prod

# ── 阶段 2：运行 ────────────────────────────────────────────────
FROM node:22-alpine AS runtime

ENV NODE_ENV=production
# tzdata：timezone '+08:00' 与日志时间戳依赖时区数据
RUN apk add --no-cache tzdata && \
    ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && \
    echo "Asia/Shanghai" > /etc/timezone

WORKDIR /app

# 非 root 运行
RUN addgroup -S app && adduser -S app -G app

COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/package.json ./package.json
COPY --chown=app:app docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh && mkdir -p /app/uploads && chown app:app /app/uploads

USER app

EXPOSE 3000

# 先跑迁移（RUN_MIGRATIONS=true 时）再启动；exec 保证 SIGTERM 直达 node
ENTRYPOINT ["./docker-entrypoint.sh"]
