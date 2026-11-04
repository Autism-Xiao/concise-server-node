import type { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 1. 全库列名统一 snake_case（配合新启用的 SnakeNamingStrategy）：
 *    dept/menu.parentId→parent_id、dict_item.dictTypeId→dict_type_id、
 *    login_log.userAgent→user_agent、oper_log.userId/errorMsg→user_id/error_msg、
 *    role_menus.menuId/roleId→menu_id/role_id、task.assigneeId→assignee_id
 * 2. 用户主键 int → varchar(32)：oper_log.user_id、tool_storage.user_id、user_roles 重建
 * 3. 删除旧 user 表，按 JeecgBoot sys_user 建表并导入其初始数据（admin/123456 等 4 个用户）
 * 4. admin 用户绑定本库 admin 角色（id=1）；额外扩展列 dept_id 对接本部门模块
 */
export class Migration1793765557497 implements MigrationInterface {
  name = 'Migration1793765557497'

  async up(queryRunner: QueryRunner): Promise<void> {
    // ---- 1. 列名统一 snake_case ----
    await queryRunner.query('ALTER TABLE `dept` CHANGE COLUMN `parentId` `parent_id` int NULL')
    await queryRunner.query('ALTER TABLE `menu` CHANGE COLUMN `parentId` `parent_id` int NULL')
    await queryRunner.query('ALTER TABLE `dict_item` CHANGE COLUMN `dictTypeId` `dict_type_id` int NOT NULL')
    await queryRunner.query('ALTER TABLE `login_log` CHANGE COLUMN `userAgent` `user_agent` varchar(255) NULL')
    await queryRunner.query('ALTER TABLE `oper_log` CHANGE COLUMN `errorMsg` `error_msg` varchar(255) NULL')
    await queryRunner.query('ALTER TABLE `role_menus` CHANGE COLUMN `menuId` `menu_id` int NOT NULL')
    await queryRunner.query('ALTER TABLE `role_menus` CHANGE COLUMN `roleId` `role_id` int NOT NULL')
    await queryRunner.query('ALTER TABLE `task` CHANGE COLUMN `assigneeId` `assignee_id` int NULL')

    // ---- 2. 用户主键 int → varchar(32) ----
    await queryRunner.query('ALTER TABLE `oper_log` CHANGE COLUMN `userId` `user_id` varchar(32) NULL')
    await queryRunner.query('ALTER TABLE `tool_storage` MODIFY COLUMN `user_id` varchar(32) NULL')

    // ---- 3. user_roles 重建为字符串用户主键 ----
    await queryRunner.query('DROP TABLE `user_roles`')
    await queryRunner.query(`CREATE TABLE \`user_roles\` (
      \`user_id\` varchar(32) NOT NULL COMMENT '用户ID(sys_user.id)',
      \`role_id\` int NOT NULL COMMENT '角色ID',
      PRIMARY KEY (\`user_id\`, \`role_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户-角色关联表'`)

    // ---- 4. 旧 user 表 → sys_user（JeecgBoot 结构）----
    await queryRunner.query('DROP TABLE `user`')
    await queryRunner.query(`CREATE TABLE \`sys_user\` (
      \`id\` varchar(32) NOT NULL COMMENT '主键id',
      \`username\` varchar(100) NULL COMMENT '登录账号',
      \`realname\` varchar(100) NULL COMMENT '真实姓名',
      \`password\` varchar(255) NULL COMMENT '密码',
      \`salt\` varchar(45) NULL COMMENT 'md5密码盐',
      \`avatar\` varchar(255) NULL COMMENT '头像',
      \`birthday\` date NULL COMMENT '生日',
      \`sex\` tinyint NULL COMMENT '性别(0-默认未知,1-男,2-女)',
      \`email\` varchar(45) NULL COMMENT '电子邮件',
      \`phone\` varchar(45) NULL COMMENT '电话',
      \`org_code\` varchar(64) NULL COMMENT '登录会话的机构编码',
      \`status\` tinyint NULL COMMENT '状态(1-正常,2-冻结)',
      \`del_flag\` tinyint NULL COMMENT '删除状态(0-正常,1-已删除)',
      \`third_id\` varchar(100) NULL COMMENT '第三方登录的唯一标识',
      \`third_type\` varchar(100) NULL COMMENT '第三方类型',
      \`activiti_sync\` tinyint NULL COMMENT '同步工作流引擎(1-同步,0-不同步)',
      \`work_no\` varchar(100) NULL COMMENT '工号，唯一键',
      \`telephone\` varchar(45) NULL COMMENT '座机号',
      \`create_by\` varchar(32) NULL COMMENT '创建人',
      \`create_time\` datetime NULL COMMENT '创建时间',
      \`update_by\` varchar(32) NULL COMMENT '更新人',
      \`update_time\` datetime NULL COMMENT '更新时间',
      \`user_identity\` tinyint NULL COMMENT '身份（1普通成员 2上级）',
      \`depart_ids\` varchar(1000) NULL COMMENT '负责部门',
      \`client_id\` varchar(64) NULL COMMENT '设备ID',
      \`login_tenant_id\` int NULL COMMENT '上次登录选择租户ID',
      \`bpm_status\` varchar(2) NULL COMMENT '流程入职离职状态',
      \`sign_enable\` tinyint NULL COMMENT '是否启用个性签名（0 否 1是）',
      \`sign\` varchar(500) NULL COMMENT '个性签名',
      \`main_dep_post_id\` varchar(32) NULL COMMENT '主岗位（部门岗位id）',
      \`position_type\` varchar(32) NULL COMMENT '职务(字典)',
      \`last_pwd_update_time\` datetime NULL COMMENT '上一次修改密码的时间',
      \`sort\` int NULL COMMENT '排序',
      \`iz_hide_contact\` varchar(1) NULL COMMENT '是否隐藏联系方式（0 否 1是）',
      \`dept_id\` int NULL COMMENT '所属部门ID（本项目扩展，对接 dept 模块）',
      PRIMARY KEY (\`id\`) USING BTREE,
      UNIQUE KEY \`uniq_sys_user_work_no\` (\`work_no\`) USING BTREE,
      UNIQUE KEY \`uniq_sys_user_username\` (\`username\`) USING BTREE,
      UNIQUE KEY \`uniq_sys_user_phone\` (\`phone\`) USING BTREE,
      UNIQUE KEY \`uniq_sys_user_email\` (\`email\`) USING BTREE,
      KEY \`idx_su_status\` (\`status\`),
      KEY \`idx_su_del_flag\` (\`del_flag\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表'`)

    // JeecgBoot 初始数据（密码为 PBEWithMD5AndDES(username, '123456', salt)）
    await queryRunner.query(`INSERT INTO \`sys_user\` (\`id\`, \`username\`, \`realname\`, \`password\`, \`salt\`, \`avatar\`, \`birthday\`, \`sex\`, \`email\`, \`phone\`, \`org_code\`, \`status\`, \`del_flag\`, \`work_no\`, \`create_by\`, \`create_time\`, \`update_by\`, \`update_time\`, \`user_identity\`, \`depart_ids\`, \`login_tenant_id\`, \`bpm_status\`, \`last_pwd_update_time\`, \`sort\`, \`dept_id\`) VALUES
      ('1714471285016895490', 'ceshi', '测试用户', 'a9932bb12d2cbc5a', 'AF4vhXUz', NULL, '2024-04-11', NULL, 'winter@jeecg.org', '15201111112', NULL, 1, 0, '123', 'admin', '2023-10-18 10:39:42', 'admin', '2026-08-20 23:00:25', 1, '', 0, NULL, '2025-11-25 15:42:34', 1000, NULL),
      ('3d464b4ea0d2491aab8a7bde74c57e95', 'zhangsan', '张三', '02ea098224c7d0d2077c14b9a3a1ed16', 'x5xRdeKB', 'https://static.jeecg.com/temp/jmlogo_1606575041993.png', '2024-04-11', NULL, '111@1.com', '13426411111', '财务部', 1, 0, '0005', 'admin', '2020-05-14 21:26:24', 'admin', '2024-04-26 13:25:37', 1, '', NULL, NULL, '2025-11-25 15:42:34', 1000, NULL),
      ('a75d45a015c44384a04449ee80dc3503', 'jeecg', 'jeecg', 'eee378a1258530cb', 'mIgiYJow', 'https://static.jeecg.com/temp/国炬软件logo_1606575029126.png', NULL, 1, '418799587@qq.com', '18611788525', 'A02A01', 1, 0, '00002', 'admin', '2019-02-13 16:02:36', 'admin', '2023-10-18 13:51:36', 1, '', 1001, NULL, '2025-11-25 15:42:34', 1000, NULL),
      ('e9ca23d68d884d4ebb19d07889727dae', 'admin', '管理员', 'cb362cfeefbf3d8d', 'RCGTeGiH', 'https://static.jeecg.com/temp/国炬软件logo_1606575029126.png', '1986-02-01', 1, 'jeecg@163.com', '18611111111', 'A01A03', 1, 0, '00001', NULL, '2019-06-21 17:54:10', 'admin', '2025-12-03 19:12:32', 2, '', 1000, 0, '2025-11-25 15:42:34', 1000, 1)`)

    // admin 用户绑定本库 admin 角色
    await queryRunner.query(
      "INSERT INTO `user_roles` (`user_id`, `role_id`) SELECT 'e9ca23d68d884d4ebb19d07889727dae', id FROM `role` WHERE `name` = 'admin' LIMIT 1"
    )
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE `sys_user`')
    await queryRunner.query(`CREATE TABLE \`user\` (
      \`id\` int NOT NULL AUTO_INCREMENT COMMENT '用户ID',
      \`username\` varchar(32) NOT NULL COMMENT '登录账号',
      \`realname\` varchar(100) NOT NULL COMMENT '真实姓名',
      \`password\` varchar(128) NOT NULL COMMENT '密码（bcrypt 加密后）',
      \`avatar\` varchar(255) NULL COMMENT '头像',
      \`sex\` tinyint NOT NULL DEFAULT 0 COMMENT '性别(0-默认未知,1-男,2-女)',
      \`phone\` varchar(45) NULL COMMENT '手机号',
      \`telephone\` varchar(45) NULL COMMENT '座机号',
      \`email\` varchar(64) NULL COMMENT '电子邮件',
      \`birthday\` date NULL COMMENT '生日',
      \`work_no\` varchar(100) NULL COMMENT '工号，唯一',
      \`status\` tinyint NOT NULL DEFAULT 1 COMMENT '状态：0禁用 1启用',
      \`del_flag\` tinyint NOT NULL DEFAULT 0 COMMENT '删除状态(0-正常,1-已删除)',
      \`create_by\` varchar(32) NULL COMMENT '创建人',
      \`update_by\` varchar(32) NULL COMMENT '更新人',
      \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
      \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
      \`dept_id\` int NULL DEFAULT 0 COMMENT '所属部门ID，0为未分配',
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`IDX_user_username\` (\`username\`),
      UNIQUE KEY \`uniq_user_work_no\` (\`work_no\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表（对齐 JeecgBoot sys_user）'`)
    await queryRunner.query(`INSERT INTO \`user\` (\`id\`, \`username\`, \`realname\`, \`password\`, \`status\`, \`del_flag\`, \`work_no\`, \`created_at\`, \`updated_at\`, \`dept_id\`) VALUES
      (1, 'admin', '管理员', '$2a$10$placeholderbcrypt', 1, 0, '00001', NOW(), NOW(), 1),
      (2, 'guest', '访客甲', '$2a$10$placeholderbcrypt', 1, 0, '00003', NOW(), NOW(), NULL),
      (3, 'auditor1', '审计员一号', '$2a$10$placeholderbcrypt', 1, 0, '00004', NOW(), NOW(), NULL)`)
    await queryRunner.query('DROP TABLE `user_roles`')
    await queryRunner.query(`CREATE TABLE \`user_roles\` (
      \`userId\` int NOT NULL,
      \`roleId\` int NOT NULL,
      PRIMARY KEY (\`userId\`, \`roleId\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
    await queryRunner.query('ALTER TABLE `tool_storage` MODIFY COLUMN `user_id` int NULL')
    await queryRunner.query('ALTER TABLE `oper_log` CHANGE COLUMN `user_id` `userId` int NULL')
    await queryRunner.query('ALTER TABLE `oper_log` CHANGE COLUMN `error_msg` `errorMsg` varchar(255) NULL')
    await queryRunner.query('ALTER TABLE `task` CHANGE COLUMN `assignee_id` `assigneeId` int NULL')
    await queryRunner.query('ALTER TABLE `role_menus` CHANGE COLUMN `menu_id` `menuId` int NOT NULL')
    await queryRunner.query('ALTER TABLE `role_menus` CHANGE COLUMN `role_id` `roleId` int NOT NULL')
    await queryRunner.query('ALTER TABLE `login_log` CHANGE COLUMN `user_agent` `userAgent` varchar(255) NULL')
    await queryRunner.query('ALTER TABLE `dict_item` CHANGE COLUMN `dict_type_id` `dictTypeId` int NOT NULL')
    await queryRunner.query('ALTER TABLE `menu` CHANGE COLUMN `parent_id` `parentId` int NULL')
    await queryRunner.query('ALTER TABLE `dept` CHANGE COLUMN `parent_id` `parentId` int NULL')
  }
}
