import type I18nKey from "./i18nKey";
import { en } from "./languages/en";
import { es } from "./languages/es";
import { ja } from "./languages/ja";
import { ko } from "./languages/ko";
import { th } from "./languages/th";
import { vi } from "./languages/vi";
import { zh_CN } from "./languages/zh_CN";
import { zh_TW } from "./languages/zh_TW";
import {
	DEFAULT_LOCALE,
	normalizeLocale,
	type SupportedLocale,
} from "./locales";

export type Translation = {
	[K in I18nKey]: string;
};

const defaultTranslation = en;

const map: { [key: string]: Translation } = {
	es: es,
	en: en,
	en_us: en,
	en_gb: en,
	en_au: en,
	"zh-tw": zh_TW,
	"zh-cn": zh_CN,
	zh_cn: zh_CN,
	zh_tw: zh_TW,
	ja: ja,
	ja_jp: ja,
	ko: ko,
	ko_kr: ko,
	th: th,
	th_th: th,
	vi: vi,
	vi_vn: vi,
};

export function getTranslation(lang: string): Translation {
	return map[normalizeLocale(lang)] || defaultTranslation;
}

export function i18n(
	key: I18nKey,
	lang: SupportedLocale = DEFAULT_LOCALE,
): string {
	return getTranslation(lang)[key];
}
