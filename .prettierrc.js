module.exports = {
  // 指定最大换行长度
  printWidth: 160,
  // 缩进空格数
  tabWidth: 2,
  // 使用制表符而不是空格缩进
  useTabs: false,
  // 结尾不用分号
  semi: false,
  // 使用单引号
  singleQuote: true,
  // 对象属性名按需加引号
  quoteProps: 'as-needed',
  // JSX 中使用双引号
  jsxSingleQuote: false,
  // 多行时不加尾随逗号
  trailingComma: 'none',
  // 对象括号与文字之间加空格 { foo: bar }
  bracketSpacing: true,
  // 多行元素的 > 不单独放一行
  bracketSameLine: false,
  // 箭头函数单参数省略括号
  arrowParens: 'avoid',
  // 不需要文件开头的 @prettier 标记
  requirePragma: false,
  // 不在格式化后的文件顶部插入标记
  insertPragma: false,
  // Markdown 文本保持原有换行
  proseWrap: 'preserve',
  // HTML 空格敏感度遵守 CSS 规则
  htmlWhitespaceSensitivity: 'css',
  // 换行符自动跟随系统/文件
  endOfLine: 'auto',
  // 注：prettier-plugin-tailwindcss 为前端 Tailwind 类名排序插件，后端项目暂不启用
}
