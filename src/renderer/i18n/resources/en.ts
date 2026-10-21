/**
 * Every UI string the app translates, in English — the fallback. One nested namespace per area, so
 * a key reads where it is used (`settings.tab.providers`). `zh-CN.ts` is typed against this, so the
 * two languages cannot drift: a key added here must be added there. Untranslated keys fall back to
 * English (`fallbackLng`), which is how a string not yet migrated simply stays as it was.
 */
export interface Translation {
  settings: {
    title: string;
    sectionsAria: string;
    language: string;
    languageHint: string;
    tab: {
      providers: string;
      local: string;
      appearance: string;
      games: string;
      harness: string;
      permissions: string;
    };
  };
}

const en: Translation = {
  settings: {
    title: "Settings",
    sectionsAria: "Settings sections",
    language: "Language",
    languageHint: "Choose the language Genex uses.",
    tab: {
      providers: "Model Providers",
      local: "Local Models",
      appearance: "Appearance",
      games: "Games",
      harness: "Harness",
      permissions: "Permissions",
    },
  },
};

export default en;
