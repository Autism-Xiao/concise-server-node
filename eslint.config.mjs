// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "node_modules",
      "coverage",
      "logs",
      "*.config.js",
      // 代码生成器：文件里全是「待生成代码」的字符串模板，不该按普通源码做静态检查
      "scripts/gen-module.cjs",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      // 代码风格交给 Prettier，ESLint 只管正确性
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // 运维/冒烟脚本跑在 Node 里，没有 TS 的全局声明，
    // no-undef 会对 console/process/Buffer 一律误报；.cjs 脚本也只能用 require。
    // 这两条属于环境性误报，关掉后其余规则（未使用变量、无意义赋值等）照常生效。
    files: ["scripts/**/*.{js,cjs,mjs}"],
    languageOptions: { ecmaVersion: 2022 },
    rules: { "no-undef": "off", "@typescript-eslint/no-require-imports": "off" },
  },
);
