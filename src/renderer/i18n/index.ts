/**
 * i18n bootstrap: i18next + react-i18next, wired to the renderer's own storage. Called once before
 * React mounts (`main.tsx`), the way `initializeAppearance` is. The starting language is the saved
 * choice, or the OS language mapped onto one the app speaks; only an explicit switch in Settings is
 * remembered, so a person whose system language changes is never stuck with an old detection.
 */
import i18next, { type TFunction } from "i18next";
import { initReactI18next, useTranslation } from "react-i18next";
import en from "./resources/en.ts";
import zhCN from "./resources/zh-CN.ts";
import {
  DEFAULT_LANGUAGE,
  detectSystemLanguage,
  isLanguageCode,
  LANGUAGES,
  savedLanguage,
  type LanguageCode,
} from "./languages.ts";
import { STORAGE_KEYS, writeText } from "../storage.ts";

export { isLanguageCode, LANGUAGES, type LanguageCode } from "./languages.ts";
export type { Translation } from "./resources/en.ts";
export type { TFunction } from "i18next";
export { useTranslation };

/** Each language's strings, under i18next's `translation` namespace. */
const RESOURCES = {
  en: { translation: en },
  "zh-CN": { translation: zhCN },
} as const;

/** Boot i18next with the app's languages; called once, before the first render. */
export function initializeI18n(): Promise<TFunction> {
  return i18next.use(initReactI18next).init({
    resources: RESOURCES,
    lng: savedLanguage() ?? detectSystemLanguage(),
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: LANGUAGES.map((language) => language.code),
    // React escapes what it renders; i18next must not escape it a second time.
    interpolation: { escapeValue: false },
  });
}

/** Switch the language and remember the choice; the next launch opens in it. */
export function setLanguage(code: LanguageCode): void {
  void i18next.changeLanguage(code);
  writeText(STORAGE_KEYS.language, code);
}

/** The language on screen now, as one the app speaks. */
export function currentLanguage(): LanguageCode {
  const active = i18next.resolvedLanguage ?? i18next.language;
  return isLanguageCode(active) ? active : DEFAULT_LANGUAGE;
}
