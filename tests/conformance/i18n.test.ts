/**
 * The i18n layer: the two languages carry the same keys, the OS language maps onto one the app
 * speaks, a saved choice is honoured and an unusable one ignored, and i18next actually serves each
 * language (a switch changes what `t` returns and what `currentLanguage` reports).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import i18next from "i18next";
import en from "../../src/renderer/i18n/resources/en.ts";
import zhCN from "../../src/renderer/i18n/resources/zh-CN.ts";
import { currentLanguage, initializeI18n } from "../../src/renderer/i18n/index.ts";
import { detectSystemLanguage, isLanguageCode, LANGUAGES, savedLanguage } from "../../src/renderer/i18n/languages.ts";
import { STORAGE_KEYS } from "../../src/renderer/storage.ts";

/** Every leaf key path in a translation tree ("settings.tab.providers"). */
function leafKeys(value: unknown, prefix = ""): string[] {
  if (value && typeof value === "object" && !Array.isArray(value))
    return Object.entries(value).flatMap(([key, child]) => leafKeys(child, prefix ? `${prefix}.${key}` : key));
  return [prefix];
}

/** A localStorage stand-in for the tests, with whatever it starts with. */
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

test("zh-CN carries exactly the keys English does", () => {
  assert.deepEqual(leafKeys(zhCN).sort(), leafKeys(en).sort());
});

test("a Chinese locale maps to zh-CN, everything else to English", () => {
  assert.equal(detectSystemLanguage("zh"), "zh-CN");
  assert.equal(detectSystemLanguage("zh-CN"), "zh-CN");
  assert.equal(detectSystemLanguage("zh-TW"), "zh-CN");
  assert.equal(detectSystemLanguage("en"), "en");
  assert.equal(detectSystemLanguage("en-US"), "en");
  assert.equal(detectSystemLanguage("ja"), "en");
  assert.equal(detectSystemLanguage(undefined), "en");
});

test("only a language the app speaks is a language code", () => {
  assert.equal(isLanguageCode("en"), true);
  assert.equal(isLanguageCode("zh-CN"), true);
  assert.equal(isLanguageCode("fr"), false);
  assert.equal(isLanguageCode(""), false);
  assert.equal(isLanguageCode(null), false);
  assert.equal(LANGUAGES.length, 2);
});

test("a saved choice is honoured; an absent or dropped one is not", () => {
  assert.equal(savedLanguage(fakeStorage({ [STORAGE_KEYS.language]: "zh-CN" })), "zh-CN");
  assert.equal(savedLanguage(fakeStorage({ [STORAGE_KEYS.language]: "en" })), "en");
  assert.equal(savedLanguage(fakeStorage({ [STORAGE_KEYS.language]: "klingon" })), null);
  assert.equal(savedLanguage(fakeStorage()), null);
});

test("i18next serves each language, and currentLanguage follows a switch", async () => {
  await initializeI18n();
  assert.equal(i18next.t("settings.tab.providers"), "Model Providers");
  assert.equal(currentLanguage(), "en");
  await i18next.changeLanguage("zh-CN");
  assert.equal(i18next.t("settings.tab.providers"), "模型供应商");
  assert.equal(i18next.t("settings.title"), "设置");
  assert.equal(currentLanguage(), "zh-CN");
  // A key only English defines falls back to English rather than showing the key.
  await i18next.changeLanguage("en");
  assert.equal(i18next.t("settings.tab.permissions"), "Permissions");
});
