import { describe, it, expect } from "vitest";
import { _STRINGS, detectLang, t } from "../src/i18n.js";

describe("i18n", () => {
    it("has the same keys in French and English", () => {
        expect(Object.keys(_STRINGS.fr).sort()).toEqual(Object.keys(_STRINGS.en).sort());
    });
    it("defaults to French", () => {
        expect(detectLang("", "")).toBe("fr");
        expect(detectLang("?lang=xx", "")).toBe("fr");
    });
    it("honours the query parameter, then the saved choice", () => {
        expect(detectLang("?lang=en", "fr")).toBe("en");
        expect(detectLang("", "en")).toBe("en");
    });
    it("falls back to English, then to the key", () => {
        expect(t("nav.now", "fr")).toBe("Maintenant");
        expect(t("nav.now", "ja")).toBe("Now");
        expect(t("no.such.key", "fr")).toBe("no.such.key");
    });
});
