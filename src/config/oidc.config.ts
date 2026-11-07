import { registerAs, type ConfigType } from '@nestjs/config'

import { envBoolean } from '../global/env'

/**
 * OIDC / SSO 单点登录配置（src/modules/auth/services/sso.service.ts）
 *
 * 标准授权码流程：前端跳 /api/v1/auth/sso/authorize → IdP 登录 → 回调 /callback →
 * code 换 access_token → 拉 userinfo → 按 username/email 匹配本地账号（或自动建档）→
 * 签发一次性 code → 前端 /sso-callback 页用 code 换本项目 JWT。
 * 不引入 openid-client SDK，Node 22 内置 fetch + /.well-known/openid-configuration 发现足够。
 */
export const oidcConfig = registerAs('oidc', () => ({
  /** 总开关：false 时 SSO 接口直接报「未启用」，登录页不展示按钮 */
  enabled: envBoolean('OIDC_ENABLED', false),
  /** IdP 根地址，如 https://keycloak.example.com/realms/master（用于拼接 discovery 地址） */
  issuer: process.env.OIDC_ISSUER ?? '',
  clientId: process.env.OIDC_CLIENT_ID ?? '',
  clientSecret: process.env.OIDC_CLIENT_SECRET ?? '',
  /** 授权范围，默认标准三件套 */
  scope: process.env.OIDC_SCOPE ?? 'openid profile email',
  /** 回调地址：留空则按当前请求的 protocol/host 自动推导（/api/v1/auth/sso/callback） */
  redirectUri: process.env.OIDC_REDIRECT_URI ?? '',
  /** 登录成功后回跳的前端页面（一次性 code 通过 query 传入），默认 Vite dev 地址 */
  frontendRedirect: process.env.OIDC_FRONTEND_REDIRECT ?? 'http://localhost:5173/sso-callback',
  /** 用 userinfo 的哪个字段作为本地账号映射键 */
  usernameClaim: process.env.OIDC_USERNAME_CLAIM ?? 'preferred_username',
  /** 本地查无此人时是否自动建档（密码随机，只能走 SSO 登录） */
  autoCreate: envBoolean('OIDC_AUTO_CREATE', true),
  /** 自动建档时绑定的角色编码（逗号分隔），空 = 不绑任何角色 */
  defaultRoles: (process.env.OIDC_DEFAULT_ROLES ?? '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}))

export type OidcConfig = ConfigType<typeof oidcConfig>
