import { Column, Entity, PrimaryColumn } from 'typeorm'

/**
 * 应用密钥版本表：client_secret 只存 sha256 哈希，明文在「创建 / 重置」那一刻返回一次
 *
 * 为什么版本化：密钥轮换时旧密钥可以撤销而新密钥立即生效，第三方切换才有窗口期；
 * 单列设计只能"改了就全失效"，对接方会直接断线。
 * secretPrefix（前 8 位明文）只用于列表里区分"哪把钥匙"，不构成安全暴露。
 */
@Entity('sys_app_secret')
export class SysAppSecretEntity {
  @PrimaryColumn({ type: 'varchar', length: 32, comment: '主键id' })
  id: string

  @Column({ type: 'varchar', length: 32, name: 'app_id', comment: '应用id' })
  appId: string

  @Column({ type: 'char', length: 64, name: 'secret_hash', comment: 'client_secret的sha256哈希' })
  secretHash: string

  @Column({ type: 'varchar', length: 12, name: 'secret_prefix', comment: '密钥前8位明文(识别用)' })
  secretPrefix: string

  @Column({ type: 'char', length: 1, default: '0', comment: '状态(0有效 1撤销)' })
  status: string

  @Column({ type: 'datetime', precision: 3, name: 'last_used_at', nullable: true, comment: '最近一次换取token时间' })
  lastUsedAt?: Date | null

  @Column({ type: 'datetime', precision: 3, name: 'create_time', comment: '创建时间' })
  createTime: Date
}
