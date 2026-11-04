-- Table structure for sys_user
-- ----------------------------
DROP TABLE IF EXISTS `sys_user`;
CREATE TABLE `sys_user` (
  `id` varchar(32) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL COMMENT '主键id',
  `username` varchar(100) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '登录账号',
  `realname` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT '真实姓名',
  `password` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '密码',
  `salt` varchar(45) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT 'md5密码盐',
  `avatar` varchar(255) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '头像',
  `birthday` date DEFAULT NULL COMMENT '生日',
  `sex` tinyint(1) DEFAULT NULL COMMENT '性别(0-默认未知,1-男,2-女)',
  `email` varchar(45) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '电子邮件',
  `phone` varchar(45) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '电话',
  `org_code` varchar(64) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '登录会话的机构编码',
  `status` tinyint(1) DEFAULT NULL COMMENT '性别(1-正常,2-冻结)',
  `del_flag` tinyint(1) DEFAULT NULL COMMENT '删除状态(0-正常,1-已删除)',
  `third_id` varchar(100) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '第三方登录的唯一标识',
  `third_type` varchar(100) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '第三方类型',
  `activiti_sync` tinyint(1) DEFAULT NULL COMMENT '同步工作流引擎(1-同步,0-不同步)',
  `work_no` varchar(100) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '工号，唯一键',
  `telephone` varchar(45) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '座机号',
  `create_by` varchar(32) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '创建人',
  `create_time` datetime DEFAULT NULL COMMENT '创建时间',
  `update_by` varchar(32) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '更新人',
  `update_time` datetime DEFAULT NULL COMMENT '更新时间',
  `user_identity` tinyint(1) DEFAULT NULL COMMENT '身份（1普通成员 2上级）',
  `depart_ids` varchar(1000) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '负责部门',
  `client_id` varchar(64) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '设备ID',
  `login_tenant_id` int DEFAULT NULL COMMENT '上次登录选择租户ID',
  `bpm_status` varchar(2) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '流程入职离职状态',
  `sign_enable` tinyint(1) DEFAULT NULL COMMENT '是否启用个性签名（0 否 1是）',
  `sign` varchar(500) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '个性签名',
  `main_dep_post_id` varchar(32) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '主岗位（部门岗位id）',
  `position_type` varchar(32) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '职务(字典)',
  `last_pwd_update_time` datetime DEFAULT NULL COMMENT '上一次修改密码的时间',
  `sort` int DEFAULT NULL COMMENT '排序',
  `iz_hide_contact` varchar(1) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL COMMENT '是否隐藏联系方式（0 否 1是）',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uniq_sys_user_work_no` (`work_no`) USING BTREE,
  UNIQUE KEY `uniq_sys_user_username` (`username`) USING BTREE,
  UNIQUE KEY `uniq_sys_user_phone` (`phone`) USING BTREE,
  UNIQUE KEY `uniq_sys_user_email` (`email`) USING BTREE,
  KEY `idx_su_status` (`status`) USING BTREE,
  KEY `idx_su_del_flag` (`del_flag`) USING BTREE,
  KEY `idx_su_del_username` (`username`,`del_flag`) USING BTREE,
  KEY `idx_su_main_dep_post_id` (`main_dep_post_id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3 ROW_FORMAT=DYNAMIC COMMENT='用户表';

-- ----------------------------
-- Records of sys_user
-- ----------------------------
BEGIN;
INSERT INTO `sys_user` (`id`, `username`, `realname`, `password`, `salt`, `avatar`, `birthday`, `sex`, `email`, `phone`, `org_code`, `status`, `del_flag`, `third_id`, `third_type`, `activiti_sync`, `work_no`, `telephone`, `create_by`, `create_time`, `update_by`, `update_time`, `user_identity`, `depart_ids`, `client_id`, `login_tenant_id`, `bpm_status`, `sign_enable`, `sign`, `main_dep_post_id`, `position_type`, `last_pwd_update_time`, `sort`, `iz_hide_contact`) VALUES ('1714471285016895490', 'ceshi', '测试用户', 'a9932bb12d2cbc5a', 'AF4vhXUz', NULL, '2024-04-11', NULL, 'winter@jeecg.org', '15201111112', NULL, 1, 0, NULL, NULL, 1, '123', NULL, 'admin', '2023-10-18 10:39:42', 'admin', '2026-08-20 23:00:25', 1, '', NULL, 0, NULL, NULL, NULL, '', NULL, '2025-11-25 15:42:34', 1000, NULL);
INSERT INTO `sys_user` (`id`, `username`, `realname`, `password`, `salt`, `avatar`, `birthday`, `sex`, `email`, `phone`, `org_code`, `status`, `del_flag`, `third_id`, `third_type`, `activiti_sync`, `work_no`, `telephone`, `create_by`, `create_time`, `update_by`, `update_time`, `user_identity`, `depart_ids`, `client_id`, `login_tenant_id`, `bpm_status`, `sign_enable`, `sign`, `main_dep_post_id`, `position_type`, `last_pwd_update_time`, `sort`, `iz_hide_contact`) VALUES ('3d464b4ea0d2491aab8a7bde74c57e95', 'zhangsan', '张三', '02ea098224c7d0d2077c14b9a3a1ed16', 'x5xRdeKB', 'https://static.jeecg.com/temp/jmlogo_1606575041993.png', '2024-04-11', NULL, '111@1.com', '13426411111', '财务部', 1, 0, NULL, NULL, 1, '0005', NULL, 'admin', '2020-05-14 21:26:24', 'admin', '2024-04-26 13:25:37', 1, '', NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2025-11-25 15:42:34', 1000, NULL);
INSERT INTO `sys_user` (`id`, `username`, `realname`, `password`, `salt`, `avatar`, `birthday`, `sex`, `email`, `phone`, `org_code`, `status`, `del_flag`, `third_id`, `third_type`, `activiti_sync`, `work_no`, `telephone`, `create_by`, `create_time`, `update_by`, `update_time`, `user_identity`, `depart_ids`, `client_id`, `login_tenant_id`, `bpm_status`, `sign_enable`, `sign`, `main_dep_post_id`, `position_type`, `last_pwd_update_time`, `sort`, `iz_hide_contact`) VALUES ('a75d45a015c44384a04449ee80dc3503', 'jeecg', 'jeecg', 'eee378a1258530cb', 'mIgiYJow', 'https://static.jeecg.com/temp/国炬软件logo_1606575029126.png', NULL, 1, '418799587@qq.com', '18611788525', 'A02A01', 1, 0, NULL, NULL, 1, '00002', NULL, 'admin', '2019-02-13 16:02:36', 'admin', '2023-10-18 13:51:36', 1, '', NULL, 1001, NULL, NULL, NULL, NULL, NULL, '2025-11-25 15:42:34', 1000, NULL);
INSERT INTO `sys_user` (`id`, `username`, `realname`, `password`, `salt`, `avatar`, `birthday`, `sex`, `email`, `phone`, `org_code`, `status`, `del_flag`, `third_id`, `third_type`, `activiti_sync`, `work_no`, `telephone`, `create_by`, `create_time`, `update_by`, `update_time`, `user_identity`, `depart_ids`, `client_id`, `login_tenant_id`, `bpm_status`, `sign_enable`, `sign`, `main_dep_post_id`, `position_type`, `last_pwd_update_time`, `sort`, `iz_hide_contact`) VALUES ('e9ca23d68d884d4ebb19d07889727dae', 'admin', '管理员', 'cb362cfeefbf3d8d', 'RCGTeGiH', 'https://static.jeecg.com/temp/国炬软件logo_1606575029126.png', '1986-02-01', 1, 'jeecg@163.com', '18611111111', 'A01A03', 1, 0, NULL, NULL, 1, '00001', NULL, NULL, '2019-06-21 17:54:10', 'admin', '2025-12-03 19:12:32', 2, '', NULL, 1000, NULL, 0, NULL, '', NULL, '2025-11-25 15:42:34', 1000, NULL);
COMMIT;

-- ----------------------------
