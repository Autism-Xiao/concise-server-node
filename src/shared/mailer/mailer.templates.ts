/**
 * 邮件模板：纯字符串拼 HTML，不引模板引擎。
 *
 * 为什么不用 ejs/pug：本仓库总共就两三种邮件，引一个模板引擎要管 loader、缓存、
 * 编译期路径（nest build 后模板文件还得配 assets 复制）。字符串拼装零依赖、零打包配置。
 *
 * 写模板的约束：
 * - 全用内联样式（很多邮箱客户端会剥掉 <style>）
 * - 不写外链图片（默认被拦，且会暴露发信场景）
 * - 关键信息（验证码）用大字号独立成行，方便手机上一眼看到
 */

export interface RenderedMail {
  subject: string
  html: string
  text: string
}

/** 统一外壳：白底卡片 + 页脚免责声明 */
function layout(title: string, inner: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${title}</title></head>
<body style="margin:0;padding:24px 12px;background:#f5f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;color:#1f2329;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5e6eb;border-radius:10px;padding:28px 24px;">
    ${inner}
  </div>
  <p style="max-width:520px;margin:16px auto 0;font-size:12px;line-height:20px;color:#8f959e;text-align:center;">
    本邮件由系统自动发出，请勿直接回复。若非本人操作，请及时联系管理员。
  </p>
</body>
</html>`
}

/** 重置密码验证码 */
export function renderResetCodeMail(data: { realname?: string; code: string; ttlMinutes: number; ip?: string }): RenderedMail {
  const name = data.realname?.trim() || '你好'
  const subject = '重置密码验证码'
  const html = layout(
    subject,
    `<h2 style="margin:0 0 16px;font-size:18px;font-weight:600;">重置密码</h2>
     <p style="margin:0 0 16px;font-size:14px;line-height:22px;">${name}，你正在重置登录密码，验证码：</p>
     <p style="margin:0 0 16px;font-size:30px;font-weight:700;letter-spacing:8px;color:#1a6cf5;">${data.code}</p>
     <p style="margin:0 0 8px;font-size:14px;line-height:22px;color:#4e5969;">验证码 ${data.ttlMinutes} 分钟内有效，只能使用一次。</p>
     <p style="margin:0;font-size:13px;line-height:20px;color:#8f959e;">如果你没有申请重置密码，可以忽略本邮件，密码不会被修改。${
       data.ip ? `本次请求来源 IP：${data.ip}` : ''
     }</p>`
  )
  const text = `${name}，你正在重置登录密码，验证码：${data.code}（${data.ttlMinutes} 分钟内有效，仅可使用一次）。若非本人操作请忽略本邮件。`
  return { subject, html, text }
}

/** 测试信（配置 SMTP 后验证连通性用） */
export function renderTestMail(data: { operator?: string; at: string }): RenderedMail {
  const subject = 'SMTP 测试邮件'
  const html = layout(
    subject,
    `<h2 style="margin:0 0 16px;font-size:18px;font-weight:600;">SMTP 已连通</h2>
     <p style="margin:0 0 8px;font-size:14px;line-height:22px;">收到这封邮件说明发信配置可用。</p>
     <p style="margin:0;font-size:13px;line-height:20px;color:#8f959e;">操作人：${data.operator || '未知'} · 时间：${data.at}</p>`
  )
  const text = `SMTP 已连通。操作人：${data.operator || '未知'}，时间：${data.at}`
  return { subject, html, text }
}

/** 新建账号通知（带初始密码，让重置流程之外多一条发信场景） */
export function renderAccountCreatedMail(data: { realname?: string; username: string; password: string; loginUrl?: string }): RenderedMail {
  const name = data.realname?.trim() || data.username
  const subject = '账号已开通'
  const html = layout(
    subject,
    `<h2 style="margin:0 0 16px;font-size:18px;font-weight:600;">账号已开通</h2>
     <p style="margin:0 0 12px;font-size:14px;line-height:22px;">${name}，你的账号已创建，登录信息如下：</p>
     <table style="width:100%;font-size:14px;line-height:24px;border-collapse:collapse;">
       <tr><td style="width:88px;color:#8f959e;">账号</td><td style="font-family:ui-monospace,Menlo,Consolas,monospace;">${data.username}</td></tr>
       <tr><td style="color:#8f959e;">初始密码</td><td style="font-family:ui-monospace,Menlo,Consolas,monospace;">${data.password}</td></tr>
       ${data.loginUrl ? `<tr><td style="color:#8f959e;">登录地址</td><td>${data.loginUrl}</td></tr>` : ''}
     </table>
     <p style="margin:16px 0 0;font-size:13px;line-height:20px;color:#8f959e;">首次登录后请立即修改密码。</p>`
  )
  const text = `${name}，账号已开通。账号：${data.username}，初始密码：${data.password}。首次登录后请立即修改密码。`
  return { subject, html, text }
}
