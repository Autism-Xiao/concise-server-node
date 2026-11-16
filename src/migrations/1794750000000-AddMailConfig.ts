import { type MigrationInterface, type QueryRunner } from 'typeorm'

/**
 * 邮件通道参数（3 条内置参数，挂在 sys_config 的 mail 分组下）
 *
 * 只放「非密钥」的开关与展示信息：
 * - mail.enabled：发信总开关，关掉时所有发信退化为 dry-run（写内存 outbox，不发真信）
 * - mail.from：发件人展示名/地址，SMTP 账号优先兜底
 * - mail.resetCode.ttlMinutes：忘记密码验证码有效期
 *
 * SMTP 的 host / user / password 一律留在环境变量（MAIL_SMTP_*）：
 * sys_config 的内容会原样出现在「参数配置」页面，密码放进来等于对管理员公开。
 */
export class AddMailConfig1794750000000 implements MigrationInterface {
  name = 'AddMailConfig1794750000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT IGNORE INTO \`sys_config\` (\`config_key\`, \`config_value\`, \`value_type\`, \`config_group\`, \`name\`, \`remark\`, \`is_builtin\`)
      VALUES
        ('mail.enabled', 'false', 'boolean', 'mail', '邮件发送总开关', '关闭时忘记密码等功能退化为 dry-run：邮件不真发，内容留在内存 outbox（GET /v1/mail/outbox 可查）', 1),
        ('mail.from', '', 'string', 'mail', '发件人', '如「系统通知 <no-reply@example.com>」；留空则用 SMTP 账号兜底', 1),
        ('mail.resetCode.ttlMinutes', '5', 'number', 'mail', '重置密码验证码有效期（分钟）', '忘记密码邮件里 6 位验证码的有效时长，建议 5~15', 1)
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DELETE FROM `sys_config` WHERE `config_key` IN ('mail.enabled','mail.from','mail.resetCode.ttlMinutes')")
  }
}
