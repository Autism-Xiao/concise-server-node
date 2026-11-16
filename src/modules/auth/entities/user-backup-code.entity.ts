import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm'

/**
 * 两步验证备份恢复码
 *
 * 用途：认证器丢失/换手机时，用一次性码替代 TOTP 登录（否则账号直接被锁死在门外）。
 * 只存 sha256 摘要，明文在生成时一次性返回，之后无法再取回。
 *
 * 为什么不用 Argon2：备份码是 8 位高熵随机串（32^8 ≈ 1.1e12），
 * 登录时 10 条比对若走慢哈希要 500ms+，sha256 足够且不拖慢登录。
 */
@Entity('sys_user_backup_code')
export class UserBackupCodeEntity {
  @PrimaryColumn({ type: 'char', length: 36 })
  id: string

  @Column({ name: 'user_id', type: 'varchar', length: 32 })
  userId: string

  @Column({ name: 'code_hash', type: 'char', length: 64 })
  codeHash: string

  @Column({ name: 'used_at', type: 'datetime', precision: 6, nullable: true })
  usedAt?: Date | null

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date
}
