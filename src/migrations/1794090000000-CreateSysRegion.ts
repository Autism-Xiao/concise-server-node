import { type MigrationInterface, type QueryRunner } from 'typeorm'

/** 34 个省级行政区划预置数据（与用户提供的省级清单一致） */
const PROVINCES: Array<[string, string, string, string, string, string, number, number]> = [
  // areaCode, name, shortName, fullName, pinyin 拆在下面拼，这里按列 [areaCode, name, shortName, fullName, zipCode, level, lng, lat]
  ['110000000000', '北京市', '北京', '北京', 'BeiJing', '000000', 116.407526, 39.90403],
  ['120000000000', '天津市', '天津', '天津', 'TianJin', '000000', 117.200983, 39.084158],
  ['130000000000', '河北省', '河北', '河北', 'HeBei', '000000', 114.468664, 38.037057],
  ['140000000000', '山西省', '山西', '山西', 'ShanXi', '000000', 112.562398, 37.873531],
  ['150000000000', '内蒙古自治区', '内蒙古', '内蒙古', 'NeiMengGu', '000000', 111.765617, 40.817498],
  ['210000000000', '辽宁省', '辽宁', '辽宁', 'LiaoNing', '000000', 123.42944, 41.835441],
  ['220000000000', '吉林省', '吉林', '吉林', 'JiLin', '000000', 125.32599, 43.896536],
  ['230000000000', '黑龙江省', '黑龙江', '黑龙江', 'HeiLongJiang', '000000', 126.661669, 45.742347],
  ['310000000000', '上海市', '上海', '上海', 'ShangHai', '000000', 121.473701, 31.230416],
  ['320000000000', '江苏省', '江苏', '江苏', 'JiangSu', '000000', 118.763232, 32.061707],
  ['330000000000', '浙江省', '浙江', '浙江', 'ZheJiang', '000000', 120.152791, 30.267446],
  ['340000000000', '安徽省', '安徽', '安徽', 'AnHui', '000000', 117.284922, 31.861184],
  ['350000000000', '福建省', '福建', '福建', 'FuJian', '000000', 119.295144, 26.100779],
  ['360000000000', '江西省', '江西', '江西', 'JiangXi', '000000', 115.909228, 28.675696],
  ['370000000000', '山东省', '山东', '山东', 'ShanDong', '000000', 117.020359, 36.66853],
  ['410000000000', '河南省', '河南', '河南', 'HeNan', '000000', 113.753602, 34.765515],
  ['420000000000', '湖北省', '湖北', '湖北', 'HuBei', '000000', 114.341861, 30.546498],
  ['430000000000', '湖南省', '湖南', '湖南', 'HuNan', '000000', 112.98381, 28.112444],
  ['440000000000', '广东省', '广东', '广东', 'GuangDong', '000000', 113.26653, 23.132191],
  ['450000000000', '广西壮族自治区', '广西', '广西', 'GuangXi', '000000', 108.327546, 22.815478],
  ['460000000000', '海南省', '海南', '海南', 'HaiNan', '000000', 110.349228, 20.017377],
  ['500000000000', '重庆市', '重庆', '重庆', 'ChongQing', '000000', 106.551556, 29.563009],
  ['510000000000', '四川省', '四川', '四川', 'SiChuan', '000000', 104.075931, 30.651651],
  ['520000000000', '贵州省', '贵州', '贵州', 'GuiZhou', '000000', 106.70741, 26.598194],
  ['530000000000', '云南省', '云南', '云南', 'YunNan', '000000', 102.710002, 25.045806],
  ['540000000000', '西藏自治区', '西藏', '西藏', 'XiZang', '000000', 91.117212, 29.646922],
  ['610000000000', '陕西省', '陕西', '陕西', 'ShanXi', '000000', 108.954239, 34.265472],
  ['620000000000', '甘肃省', '甘肃', '甘肃', 'GanSu', '000000', 103.826308, 36.059421],
  ['630000000000', '青海省', '青海', '青海', 'QingHai', '000000', 101.780199, 36.620901],
  ['640000000000', '宁夏回族自治区', '宁夏', '宁夏', 'NingXia', '000000', 106.258754, 38.471317],
  ['650000000000', '新疆维吾尔自治区', '新疆', '新疆', 'XinJiang', '000000', 87.627704, 43.793026]
]

/** 港澳台的区划代码/邮编与前 31 个省格式不同，单独列出 */
const SPECIAL: Array<[string, string, string, string, string, string, string, string]> = [
  // areaCode, cityCode, zipCode, name, shortName, fullName, pinyin, lng/lat
  ['810000000000', '00852', '999077', '香港特别行政区', '香港', '香港', 'Hong Kong', '114.173355,22.320048'],
  ['820000000000', '00853', '999078', '澳门特别行政区', '澳门', '澳门', 'Macau', '113.549090,22.198951'],
  ['710000000000', '', '000000', '台湾省', '台湾', '台湾', 'Taiwan', '121.520076,25.030724']
]

/**
 * 行政区划表 sys_region：
 *  - area_code 全局唯一（区划代码），parent_code 级联（顶级为 '0'），level 0省/1市/2区县/3街道
 *  - 显式 COLLATE=utf8mb4_unicode_ci：与 sys_user 等存量表一致，避免 0900_ai_ci JOIN 报错
 *  - 预置 34 个省级行政区划；市/县级数据通过 POST /v1/regions/import 批量导入
 */
export class CreateSysRegion1794090000000 implements MigrationInterface {
  name = 'CreateSysRegion1794090000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`sys_region\` (
        \`id\` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键',
        \`area_code\` VARCHAR(20) NOT NULL COMMENT '区划代码(唯一)',
        \`city_code\` VARCHAR(10) NOT NULL DEFAULT '' COMMENT '城市代码(电话区号)',
        \`parent_code\` VARCHAR(20) NOT NULL DEFAULT '0' COMMENT '上级区划代码(顶级为0)',
        \`zip_code\` VARCHAR(10) NOT NULL DEFAULT '' COMMENT '邮政编码',
        \`level\` TINYINT NOT NULL DEFAULT 0 COMMENT '层级(0省份 1城市 2区县 3街道)',
        \`level_text\` VARCHAR(10) NOT NULL DEFAULT '' COMMENT '层级文本',
        \`pid\` BIGINT NOT NULL DEFAULT 0 COMMENT '父级ID(冗余,顶级为0)',
        \`name\` VARCHAR(100) NOT NULL COMMENT '名称',
        \`short_name\` VARCHAR(50) NOT NULL DEFAULT '' COMMENT '简称',
        \`full_name\` VARCHAR(100) NOT NULL DEFAULT '' COMMENT '全称',
        \`pinyin\` VARCHAR(100) NOT NULL DEFAULT '' COMMENT '拼音',
        \`lng\` VARCHAR(20) NOT NULL DEFAULT '' COMMENT '经度',
        \`lat\` VARCHAR(20) NOT NULL DEFAULT '' COMMENT '纬度',
        \`create_time\` DATETIME NULL COMMENT '创建时间',
        \`update_time\` DATETIME NULL COMMENT '更新时间',
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uniq_sys_region_area_code\` (\`area_code\`),
        KEY \`idx_sys_region_parent_code\` (\`parent_code\`),
        KEY \`idx_sys_region_level\` (\`level\`),
        KEY \`idx_sys_region_name\` (\`name\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='行政区划'
    `)

    // 预置省级数据（已存在则跳过，重跑安全）；值均为迁移内置常量，无注入风险
    const existing = (await queryRunner.query('SELECT `area_code` FROM `sys_region`')) as Array<{ area_code: string }>
    const existingCodes = new Set(existing.map(row => row.area_code))
    const inserts: string[] = []
    for (const [areaCode, name, shortName, fullName, pinyin, zipCode, lng, lat] of PROVINCES) {
      if (existingCodes.has(areaCode)) continue
      inserts.push(`('${areaCode}', '', '0', '${zipCode}', 0, '省份', 0, '${name}', '${shortName}', '${fullName}', '${pinyin}', '${lng}', '${lat}', NOW())`)
    }
    for (const [areaCode, cityCode, zipCode, name, shortName, fullName, pinyin, geo] of SPECIAL) {
      if (existingCodes.has(areaCode)) continue
      const [lng, lat] = geo.split(',')
      inserts.push(
        `('${areaCode}', '${cityCode}', '0', '${zipCode}', 0, '省份', 0, '${name}', '${shortName}', '${fullName}', '${pinyin}', '${lng}', '${lat}', NOW())`
      )
    }
    if (inserts.length) {
      await queryRunner.query(
        `INSERT INTO \`sys_region\` (\`area_code\`, \`city_code\`, \`parent_code\`, \`zip_code\`, \`level\`, \`level_text\`, \`pid\`, \`name\`, \`short_name\`, \`full_name\`, \`pinyin\`, \`lng\`, \`lat\`, \`create_time\`) VALUES ${inserts.join(',')}`
      )
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS `sys_region`')
  }
}
