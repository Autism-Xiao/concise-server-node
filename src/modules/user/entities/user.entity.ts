import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity("user")
export class UserEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 32, unique: true, comment: "用户名" })
  username: string;

  @Column({ length: 32, comment: "昵称" })
  nickname: string;

  /** select: false —— 默认查询不带出密码 */
  @Column({ length: 128, select: false, comment: "密码（加密后）" })
  password: string;

  @Column({ length: 64, nullable: true, comment: "邮箱" })
  email?: string;

  /** 0 禁用 / 1 启用 */
  @Column({ type: "tinyint", default: 1, comment: "状态：0禁用 1启用" })
  status: number;

  @CreateDateColumn({ name: "created_at", comment: "创建时间" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", comment: "更新时间" })
  updatedAt: Date;
}
