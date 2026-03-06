export interface SupportedTranslationLanguage {
  code: string;
  label: string;
  nllb: string;
}

export const SUPPORTED_TRANSLATION_LANGUAGES: SupportedTranslationLanguage[] = [
  { code: "af", label: "Afrikaans", nllb: "afr_Latn" },
  { code: "ar", label: "Arabic", nllb: "arb_Arab" },
  { code: "az", label: "Azerbaijani", nllb: "azj_Latn" },
  { code: "be", label: "Belarusian", nllb: "bel_Cyrl" },
  { code: "bg", label: "Bulgarian", nllb: "bul_Cyrl" },
  { code: "bn", label: "Bengali", nllb: "ben_Beng" },
  { code: "bs", label: "Bosnian", nllb: "bos_Latn" },
  { code: "ca", label: "Catalan", nllb: "cat_Latn" },
  { code: "cs", label: "Czech", nllb: "ces_Latn" },
  { code: "cy", label: "Welsh", nllb: "cym_Latn" },
  { code: "da", label: "Danish", nllb: "dan_Latn" },
  { code: "de", label: "German", nllb: "deu_Latn" },
  { code: "el", label: "Greek", nllb: "ell_Grek" },
  { code: "es", label: "Spanish", nllb: "spa_Latn" },
  { code: "et", label: "Estonian", nllb: "est_Latn" },
  { code: "fa", label: "Persian", nllb: "pes_Arab" },
  { code: "fi", label: "Finnish", nllb: "fin_Latn" },
  { code: "fr", label: "French", nllb: "fra_Latn" },
  { code: "ga", label: "Irish", nllb: "gle_Latn" },
  { code: "gl", label: "Galician", nllb: "glg_Latn" },
  { code: "gu", label: "Gujarati", nllb: "guj_Gujr" },
  { code: "he", label: "Hebrew", nllb: "heb_Hebr" },
  { code: "hi", label: "Hindi", nllb: "hin_Deva" },
  { code: "hr", label: "Croatian", nllb: "hrv_Latn" },
  { code: "hu", label: "Hungarian", nllb: "hun_Latn" },
  { code: "hy", label: "Armenian", nllb: "hye_Armn" },
  { code: "id", label: "Indonesian", nllb: "ind_Latn" },
  { code: "is", label: "Icelandic", nllb: "isl_Latn" },
  { code: "it", label: "Italian", nllb: "ita_Latn" },
  { code: "ja", label: "Japanese", nllb: "jpn_Jpan" },
  { code: "ka", label: "Georgian", nllb: "kat_Geor" },
  { code: "kk", label: "Kazakh", nllb: "kaz_Cyrl" },
  { code: "km", label: "Khmer", nllb: "khm_Khmr" },
  { code: "ko", label: "Korean", nllb: "kor_Hang" },
  { code: "lt", label: "Lithuanian", nllb: "lit_Latn" },
  { code: "lv", label: "Latvian", nllb: "lvs_Latn" },
  { code: "mk", label: "Macedonian", nllb: "mkd_Cyrl" },
  { code: "ml", label: "Malayalam", nllb: "mal_Mlym" },
  { code: "mr", label: "Marathi", nllb: "mar_Deva" },
  { code: "ms", label: "Malay", nllb: "zsm_Latn" },
  { code: "mt", label: "Maltese", nllb: "mlt_Latn" },
  { code: "ne", label: "Nepali", nllb: "npi_Deva" },
  { code: "nl", label: "Dutch", nllb: "nld_Latn" },
  { code: "no", label: "Norwegian", nllb: "nob_Latn" },
  { code: "pa", label: "Punjabi", nllb: "pan_Guru" },
  { code: "pl", label: "Polish", nllb: "pol_Latn" },
  { code: "pt", label: "Portuguese", nllb: "por_Latn" },
  { code: "ro", label: "Romanian", nllb: "ron_Latn" },
  { code: "ru", label: "Russian", nllb: "rus_Cyrl" },
  { code: "sk", label: "Slovak", nllb: "slk_Latn" },
  { code: "sl", label: "Slovenian", nllb: "slv_Latn" },
  { code: "sq", label: "Albanian", nllb: "als_Latn" },
  { code: "sr", label: "Serbian", nllb: "srp_Cyrl" },
  { code: "sv", label: "Swedish", nllb: "swe_Latn" },
  { code: "sw", label: "Swahili", nllb: "swh_Latn" },
  { code: "ta", label: "Tamil", nllb: "tam_Taml" },
  { code: "te", label: "Telugu", nllb: "tel_Telu" },
  { code: "th", label: "Thai", nllb: "tha_Thai" },
  { code: "tr", label: "Turkish", nllb: "tur_Latn" },
  { code: "uk", label: "Ukrainian", nllb: "ukr_Cyrl" },
  { code: "ur", label: "Urdu", nllb: "urd_Arab" },
  { code: "uz", label: "Uzbek", nllb: "uzn_Latn" },
  { code: "vi", label: "Vietnamese", nllb: "vie_Latn" },
  { code: "zh", label: "Chinese (Simplified)", nllb: "zho_Hans" }
];

const ISO3_TO_ISO2: Record<string, string> = Object.fromEntries(
  SUPPORTED_TRANSLATION_LANGUAGES.map((entry) => [entry.nllb.slice(0, 3).toLowerCase(), entry.code])
);

const MYMEMORY_ENDPOINT = "https://api.mymemory.translated.net/get";

function resolveMyMemoryLanguageCode(lang: string): string {
  const base = lang.trim().toLowerCase().split(/[-_]/)[0];
  if (/^[a-z]{2}$/i.test(base)) {
    return base;
  }
  if (/^[a-z]{3}$/i.test(base) && ISO3_TO_ISO2[base]) {
    return ISO3_TO_ISO2[base];
  }
  throw new Error(`Unsupported language code "${lang}" for MyMemory translation.`);
}

async function translateTextWithMyMemory(text: string, sourceLang: string, targetLang: string): Promise<string> {
  if (!text.trim()) {
    return text;
  }
  const params = new URLSearchParams({
    q: text,
    langpair: `${sourceLang}|${targetLang}`
  });
  const response = await fetch(`${MYMEMORY_ENDPOINT}?${params.toString()}`, { method: "GET" });
  if (!response.ok) {
    throw new Error(`MyMemory request failed (${response.status})`);
  }
  const payload = (await response.json()) as {
    responseData?: { translatedText?: string };
    responseStatus?: number;
  };
  if (payload.responseStatus && payload.responseStatus !== 200) {
    throw new Error(`MyMemory translation failed with status ${payload.responseStatus}`);
  }
  const translated = payload.responseData?.translatedText;
  return typeof translated === "string" && translated.trim() ? translated : text;
}

export async function translateLanguage(
  sourceDict: Record<string, string>,
  targetLang: string,
  sourceLang = "en",
  onProgress?: (done: number, total: number) => void
): Promise<Record<string, string>> {
  const sourceCode = resolveMyMemoryLanguageCode(sourceLang);
  const targetCode = resolveMyMemoryLanguageCode(targetLang);
  const cache = new Map<string, string>();
  const translated: Record<string, string> = {};
  const entries = Object.entries(sourceDict);
  const total = entries.length;
  let done = 0;
  for (const [key, value] of entries) {
    if (cache.has(value)) {
      translated[key] = cache.get(value) as string;
      done += 1;
      onProgress?.(done, total);
      continue;
    }
    try {
      const out = await translateTextWithMyMemory(value, sourceCode, targetCode);
      cache.set(value, out);
      translated[key] = out;
    } catch {
      translated[key] = value;
    }
    done += 1;
    onProgress?.(done, total);
  }
  return translated;
}
