/**
 * The languages the UI speaks. Each carries its own name (its endonym), which is never translated:
 * a person looking for their language reads it in that language. `detectSystemLanguage` maps the OS
 * language onto one of these, falling back to English; only an explicit switch in Settings is
 * remembered (`i18n/index.ts`).
 */
import { browserStorage, readText } from "../storage.ts";
import { STORAGE_KEYS } from "../storage.ts";

export type LanguageCode = "en" | "zh-CN";

/** Every language the app can show, in the order Settings lists them. */
export const LANGUAGES: readonly { code: LanguageCode; label: string }[] = [
  { code: "en", label: "English" },
  { code: "zh-CN", label: "简体中文" },
];

/** The language a first launch with no saved choice and no recognisable OS language falls back to. */
export const DEFAULT_LANGUAGE: LanguageCode = "en";

/** Whether `value` names a language the app speaks. */
export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === "string" && LANGUAGES.some((language) => language.code === value);
}

/** The OS language mapped onto a language the app speaks: any Chinese locale is zh-CN, else English. */
export function detectSystemLanguage(
  navigatorLanguage: string | undefined = globalThis.navigator?.language,
): LanguageCode {
  return navigatorLanguage?.toLowerCase().startsWith("zh") ? "zh-CN" : DEFAULT_LANGUAGE;
}

/** The language saved in storage, or null when there is none or it names a language the app dropped. */
export function savedLanguage(storage = browserStorage()): LanguageCode | null {
  const saved = readText(STORAGE_KEYS.language, storage);
  return isLanguageCode(saved) ? saved : null;
}
