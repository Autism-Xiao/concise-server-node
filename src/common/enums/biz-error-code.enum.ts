/**
 * 业务错误码（响应体 code 字段）
 *
 * 分段规则（2026-11-10 细化，见 docs/2026-11-10-业务错误码分段细化.md）：
 * - 0            成功（TransformInterceptor 统一返回）
 * - 41x          验证码（沿用既有数字约定，非标准 HTTP 语义）
 * - 1001~1009    通用与账号（冻结段，值永不改动：前端判断 / 冒烟断言 / Swagger 均已引用）
 * - 429 / 503    沿用 HTTP 语义
 * - 21xx~91xx    新增分段：两位域码 + 两位序号，与旧码位数不同天然区分
 *
 * 加码铁律：一码一消费者——新增前必须写明谁在用它分支（前端 UI / 监控聚合 / 重试策略），
 * 同类细节靠 message 区分（如导入表头缺哪列都算 IMPORT_HEADER_MISMATCH）。
 * 成功判定只看 success 或 code === 0，不要用 HTTP 状态码。
 */
export enum BizErrorCode {
  // ============ 冻结段：值永不改动（存量引用：前端 / 冒烟 / Swagger / 既有惯例） ============

  /** 滑块位置不正确 */
  CAPTCHA_INVALID = 412,
  /** 验证码已过期（含已消费：Redis GET+DEL 原子消费，取不到一律视为过期） */
  CAPTCHA_EXPIRED = 413,
  /** 验证码参数缺失/非法 */
  CAPTCHA_PARAM_INVALID = 417,

  /** 参数校验失败（ValidationPipe / 手动校验） */
  PARAM_INVALID = 1001,
  /** 资源不存在 */
  NOT_FOUND = 1002,
  /** 未授权 */
  UNAUTHORIZED = 1003,
  /** 禁止访问 */
  FORBIDDEN = 1004,
  /** 业务处理失败（未细分场景的兜底业务码） */
  BUSINESS_ERROR = 1005,
  /** 服务器内部错误 */
  INTERNAL_ERROR = 1006,
  /** 登录失败（用户名或密码错误） */
  LOGIN_FAILED = 1007,
  /** 账号已停用/冻结 */
  ACCOUNT_DISABLED = 1008,
  /** 密码错误次数过多，账号临时锁定 */
  ACCOUNT_LOCKED = 1009,

  /** 请求过于频繁（限流），沿用 HTTP 429 */
  RATE_LIMITED = 429,
  /** 依赖服务不可用（如 Redis 未启用），沿用 503 */
  SERVICE_UNAVAILABLE = 503,

  // ============ 2xxx 认证与账号（消费方：登录页/静默刷新/SSO 回调的 UI 分支） ============

  /** refresh token 无效或过期 —— 消费方：前端静默刷新失败后跳登录（区别于 1003 的「从未登录」） */
  REFRESH_TOKEN_INVALID = 2101,
  /** SSO 登录凭证（state/code）无效或已过期 —— 消费方：SSO 回调页展示「重新发起登录」 */
  SSO_CREDENTIAL_INVALID = 2102,
  /** 原密码校验失败（改密流程） —— 消费方：改密弹窗定位到「原密码」输入框 */
  OLD_PASSWORD_INVALID = 2104,
  /** 登录需要两步验证码（账号已开启 2FA 但未带 totpCode） —— 消费方：登录页弹出 6 位动态码输入框 */
  TOTP_REQUIRED = 2105,
  /** 两步验证码不正确或已过期 —— 消费方：登录页/2FA 弹窗清空输入框并提示重试 */
  TOTP_INVALID = 2106,

  // ============ 3xxx 权限与角色（消费方：角色管理页禁用按钮/监控聚合） ============

  /** 内置角色保护（编码不可改/不可删/不可停用/不可改授权，细节见 message） —— 消费方：角色页对内置行禁用编辑 */
  BUILTIN_ROLE_PROTECTED = 3101,
  /** 角色编码已被占用（唯一键冲突） —— 消费方：新建/编辑表单定位到「编码」输入框 */
  ROLE_CODE_CONFLICT = 3102,
  /** 分配的菜单 ID 无效 —— 消费方：授权树重载提示 */
  MENU_IDS_INVALID = 3103,

  // ============ 4xxx 组织架构（消费方：部门树操作后的差异化提示） ============

  /** 父级部门不存在或已删除 */
  DEPT_PARENT_NOT_FOUND = 4101,
  /** 防环校验失败（父级是自身或自己的后代） */
  DEPT_CYCLE = 4102,
  /** 存在子部门，不能删除 */
  DEPT_HAS_CHILDREN = 4103,
  /** 部门挂有用户，不能删除 */
  DEPT_HAS_USERS = 4104,

  // ============ 5xxx 字典 / 公告等系统配置（消费方：表单定位 + 删除保护提示） ============

  /** 字典编码已被占用 */
  DICT_CODE_CONFLICT = 5101,
  /** 同一字典类型下已有相同 value 的字典项 */
  DICT_ITEM_VALUE_CONFLICT = 5102,
  /** 公告状态冲突（如已发布再发布） */
  NOTICE_STATUS_CONFLICT = 5103,
  /** 字典类型下还有字典项，不能删除 */
  DICT_HAS_ITEMS = 5104,

  // ============ 6xxx 文件与导入导出（消费方：导入弹窗「下载模板」/ 上传安全监控） ============

  /** 上传文件类型不支持 */
  UPLOAD_TYPE_REJECTED = 6101,
  /** 文件头签名与扩展名不符（伪装成图片的脚本等） —— 消费方：安全监控单独聚合告警 */
  UPLOAD_SIGNATURE_MISMATCH = 6102,
  /** 导入模板表头不匹配（缺列/表头不对） —— 消费方：导入弹窗展示「下载模板」按钮 */
  IMPORT_HEADER_MISMATCH = 6103,
  /** 导入文件没有数据行（空文件 / 只有表头） —— 消费方：全部导入入口共用（assertImportRows + 各模块首行判空） */
  IMPORT_EMPTY = 6104,
  /** CSV 编码不是 UTF-8 */
  IMPORT_CSV_ENCODING = 6105,
  /** 物理文件丢失（存储目录被手动清理） */
  FILE_MISSING = 6106,

  // ============ 7xxx 协作域：日程 / 消息 / 任务（消费方：403 类差异化提示） ============

  /** 只能操作自己名下的日历/日程（越权访问他人数据） —— 消费方：监控聚合越权尝试 */
  SCHEDULE_OWNERSHIP = 7101,
  /** 消息接收人不存在或已删除 */
  MESSAGE_RECEIVER_INVALID = 7102,
  /** 任务状态机非法流转（如已取消直接完成） */
  TASK_INVALID_TRANSITION = 7103,

  // ============ 8xxx 多租户（消费方：租户管理页/安全监控） ============

  /** 租户编码已被占用 */
  TENANT_CODE_CONFLICT = 8101,
  /** 分配的角色不属于当前租户（跨租户提权防护） —— 消费方：安全监控聚合越权尝试 */
  TENANT_ROLE_BOUNDARY = 8102,
  /** 租户没有内置 admin 角色模板（需先 provision） —— 消费方：开通管理员弹窗提示「初始化角色」 */
  TENANT_NO_ADMIN_TEMPLATE = 8103,

  // ============ 9xxx 运维：定时任务 / 在线会话（消费方：运维页差异化提示） ============

  /** 定时任务缺少/无效的 cron 表达式 */
  JOB_CRON_INVALID = 9101,
  /** 在线会话不存在或已过期 */
  SESSION_EXPIRED = 9102
}
