export const SUPPORTED_LOCALES = ["zh-tw", "en"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = "zh-tw";

const localeSet = new Set<string>(SUPPORTED_LOCALES);

export function isSupportedLocale(locale: string): locale is SupportedLocale {
	return localeSet.has(locale);
}

export function normalizeLocale(locale?: string | null): SupportedLocale {
	if (!locale) {
		return DEFAULT_LOCALE;
	}

	const normalized = locale.toLowerCase().replace(/_/g, "-");

	if (normalized.startsWith("en")) {
		return "en";
	}

	if (normalized === "zh" || normalized.startsWith("zh")) {
		return "zh-tw";
	}

	return isSupportedLocale(normalized) ? normalized : DEFAULT_LOCALE;
}

export function getLocaleFromUrl(url: URL): SupportedLocale {
	const [, maybeLocale] = url.pathname.split("/");
	return maybeLocale && isSupportedLocale(maybeLocale)
		? maybeLocale
		: DEFAULT_LOCALE;
}

export function getHtmlLang(locale: SupportedLocale): string {
	return locale === "zh-tw" ? "zh-TW" : "en";
}
