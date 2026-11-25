// 「ライセンス」（docs/screens.md 6章の「このアプリについて」）の、画面に出す一覧を決める。RN・Expoに触れない（Nodeのテストから実行する）。
// 一覧の元は、生成物の `src/legal/thirdPartyLicenses.ts`（`scripts/generate-licenses.mjs`）。
import type { ThirdPartyPackage } from '../legal/thirdPartyLicenses.ts';

/** アプリが動く OS。片方の OS にだけ入るもの（AndroidX など）は、その OS でだけ出す。 */
export type LicenseOs = 'ios' | 'android';

export interface LicenseItem {
  /** 一覧のキー（名前と版の組。生成物のテストが、重ならないことを確かめている） */
  key: string;
  name: string;
  /** 「版 · ライセンスの種類」。版が1つに決まらないものは、種類だけ */
  detail: string;
  /** ライセンスの全文（先頭付近に著作権表示を含む）。画面に出す前に `reflowLicense` で詰める */
  text: string;
  /** まとめたものの中身（Maven の成果物。`group:artifact:version`）。無いものは省く */
  includes?: readonly string[];
}

/**
 * その OS のアプリに入るものの一覧。生成物の並び（名前順）のまま。**全文は、必ず出す**（MIT などは、著作権表示と許諾表示を
 * 含めることを求める）ので、全文が引けないもの（添字が範囲外）は、黙って空にせず、投げる（生成物のテストが先に気づく）。
 */
export function buildLicenseItems(
  packages: readonly ThirdPartyPackage[],
  texts: readonly string[],
  os: LicenseOs,
): LicenseItem[] {
  return packages
    .filter((item) => item.platform === undefined || item.platform === os)
    .map((item) => {
      const text = texts[item.text];
      if (text === undefined) throw new Error(`${item.name}: ライセンスの全文が引けない（添字 ${item.text}）`);
      return {
        key: `${item.name}@${item.version ?? ''}`,
        name: item.name,
        detail: item.version === undefined ? item.license : `${item.version} · ${item.license}`,
        text,
        ...(item.includes === undefined ? {} : { includes: item.includes }),
      };
    });
}

/** `Platform.OS` から、一覧の OS を決める。iOS 以外は Android とする（このアプリは、iOS と Android だけ）。 */
export function licenseOsOf(platformOs: string): LicenseOs {
  return platformOs === 'ios' ? 'ios' : 'android';
}
