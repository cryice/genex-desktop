/**
 * The same keys as `en.ts`, in Simplified Chinese. Typed against `Translation`, so a missing or
 * misspelled key is a type error, not a silent English fallback. "Harness" stays as the product
 * term it is.
 */
import type { Translation } from "./en.ts";

const zhCN: Translation = {
  settings: {
    title: "设置",
    sectionsAria: "设置分区",
    language: "语言",
    languageHint: "选择 Genex 使用的语言。",
    tab: {
      providers: "模型供应商",
      local: "本地模型",
      appearance: "外观",
      games: "游戏",
      harness: "Harness",
      permissions: "权限",
    },
  },
};

export default zhCN;
