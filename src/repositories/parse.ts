// 応答の項目を1つずつ確かめる小さな関数。形の違う応答は `invalid-response`（画面が、壊れた値で動かないように）。
// 読み込み（`GET`）のRepositoryが使う。書き込み（`POST`・`PATCH`・`DELETE`）の応答は、使う項目だけを検べる
// （CLAUDE.md。ここの関数で全項目を検べる書き方に「そろえない」）。
import { isOpaqueValue, isRecord } from './apiClient.ts';
import { AuthError } from './authError.ts';

export function invalid(): never {
  throw new AuthError('invalid-response');
}

export function str(value: unknown): string {
  return typeof value === 'string' ? value : invalid();
}

/** IDなど、中身を解釈しない不透明な値（`apiClient.ts` の `isOpaqueValue`）。 */
export function id(value: unknown): string {
  return isOpaqueValue(value) ? value : invalid();
}

export function int(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : invalid();
}

export function bool(value: unknown): boolean {
  return typeof value === 'boolean' ? value : invalid();
}

export function nullableStr(value: unknown): string | null {
  return value === null ? null : str(value);
}

export function nullableId(value: unknown): string | null {
  return value === null ? null : id(value);
}

export function nullableInt(value: unknown): number | null {
  return value === null ? null : int(value);
}

export function record(value: unknown): Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value) ? value : invalid();
}

export function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : invalid();
}

/** 決まった文字列のどれか。 */
export function oneOf<T extends string>(options: readonly T[], value: unknown): T {
  return options.find((option) => option === value) ?? invalid();
}

/**
 * 決まった文字列のどれか。知らない文字列は `'unknown'`（文字列でなければ `invalid-response`）。表示にしか使わない列挙値に使う:
 * サーバーが値を足したとき、古い版のアプリのホーム全体が読めなくなるのを避ける（CLAUDE.md）。操作の可否に関わる値には使わない。
 */
export function oneOfOrUnknown<T extends string>(options: readonly T[], value: unknown): T | 'unknown' {
  if (typeof value !== 'string') return invalid();
  return options.find((option) => option === value) ?? 'unknown';
}

/** `YYYY-MM`（月）。実在する月かまで見る。 */
export function month(value: unknown): string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : invalid();
}

/** `YYYY-MM-DD`（日付）。形だけを見る（表示にしか使わない）。 */
export function date(value: unknown): string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value) ? value : invalid();
}
