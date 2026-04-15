import I18nKey from "@i18n/i18nKey";
import { DEFAULT_LOCALE, type SupportedLocale } from "@i18n/locales";
import { i18n } from "@i18n/translation";
import { url } from "@utils/url-utils";
import { LinkPreset, type NavBarLink } from "@/types/config";

export function getLinkPresets(locale: SupportedLocale = DEFAULT_LOCALE): {
	[key in LinkPreset]: NavBarLink;
} {
	return {
		[LinkPreset.Home]: {
			name: i18n(I18nKey.home, locale),
			url: url("/", locale),
		},
		[LinkPreset.About]: {
			name: i18n(I18nKey.about, locale),
			url: url("/about/", locale),
		},
		[LinkPreset.Archive]: {
			name: i18n(I18nKey.archive, locale),
			url: url("/archive/", locale),
		},
	};
}
