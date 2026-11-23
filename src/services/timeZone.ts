// 端末のタイムゾーン（IANA名。`Asia/Tokyo` など）。グループ作成で送る（月の境目を決めるので、Workerは省略を許さず、
// `+09:00` のようなオフセットも断る。docs/backend-design.md 9章の「グループAPI」）。
// 取れないとき（IntlがないOS・`undefined`）は `null`。黙って既定値にしない: 画面が、作成を止めて案内する。

const IANA_NAME = /^[A-Za-z0-9_+-]+(\/[A-Za-z0-9_+-]+){0,2}$/;

export function getDeviceTimeZone(intl: Pick<typeof Intl, 'DateTimeFormat'> = Intl): string | null {
  try {
    const name = intl.DateTimeFormat().resolvedOptions().timeZone;
    // `UTC` のように、地域を含まない名前も、Workerは通す（形の検査だけ）。
    return typeof name === 'string' && name.length <= 64 && IANA_NAME.test(name) ? name : null;
  } catch {
    return null;
  }
}
