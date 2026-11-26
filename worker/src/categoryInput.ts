// 費目と、月ごとの負担割合のリクエスト本文の検査。DBに依存しない。形は docs/backend-design.md 9章
// 「費目・負担割合・支出・固定費」。アプリとは、コードを共有せず、docsを正として両側に書く。
//
// - 知らない項目は、書き間違いを見逃さないよう、断る（400）。失敗は、直すべき項目の名前を返す（値は返さない）。
// - 割合が、その月のメンバーと合っているか、は、DBの状態が要るので呼び出し側（categories.ts）で見る。
import { isCurrencyCodeShape, isId, isRecord, isUuid, unknownKey, type ParseResult } from './expenseInput.ts';
import { MAX_AMOUNT_MINOR, MAX_CATEGORIES_PER_GROUP, MAX_CATEGORY_NAME_LENGTH } from './limits.ts';
import { isMonth } from './months.ts';
import { BASIS_POINTS_TOTAL, type MemberShare } from './settlement.ts';
import { parseLabel } from './textInput.ts';

export interface CreateCategoryInput {
  /** アプリが作る、この作成の識別子（冪等キー）。UUID（小文字）。無ければ Worker が決める。 */
  id: string | null;
  name: string;
  icon: string;
  color: string;
}

export interface UpdateCategoryInput {
  name?: string;
  icon?: string;
  color?: string;
  archived?: boolean;
}

/** その月の費目の負担割合（上限額つきなら、超えた分の割合と、上限）。 */
export interface CategoryRuleInput {
  shares: MemberShare[];
  cap: { memberId: string; capMinor: number } | null;
  /** 上限額を入力したときの通貨。グループの通貨と違えば409 `currency_mismatch`(支出の登録と同じ)。無ければ検査しない。 */
  currencyCode: string | null;
}

const fail = (field: string): { ok: false; field: string } => ({ ok: false, field });

// アイコン・色は、アプリ側の一覧のキー。知らないキーは、アプリが既定の見た目で出す（DDLのコメント）ので、
// サーバーは形だけを見る（一覧を、アプリと二重に持たない）。
const KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,29}$/;
const isKey = (value: unknown): value is string => typeof value === 'string' && KEY_PATTERN.test(value);

export function parseCreateCategory(body: Record<string, unknown>): ParseResult<CreateCategoryInput> {
  const extra = unknownKey(body, ['id', 'name', 'icon', 'color']);
  if (extra !== null) return fail(extra);
  if (body.id !== undefined && !isUuid(body.id)) return fail('id');
  const name = parseLabel(body.name, MAX_CATEGORY_NAME_LENGTH);
  if (name === null) return fail('name');
  if (!isKey(body.icon)) return fail('icon');
  if (!isKey(body.color)) return fail('color');
  return { ok: true, value: { id: body.id === undefined ? null : body.id, name, icon: body.icon, color: body.color } };
}

export function parseUpdateCategory(body: Record<string, unknown>): ParseResult<UpdateCategoryInput> {
  const extra = unknownKey(body, ['name', 'icon', 'color', 'archived']);
  if (extra !== null) return fail(extra);
  if (Object.keys(body).length === 0) return fail('');
  const value: UpdateCategoryInput = {};
  if (body.name !== undefined) {
    const name = parseLabel(body.name, MAX_CATEGORY_NAME_LENGTH);
    if (name === null) return fail('name');
    value.name = name;
  }
  if (body.icon !== undefined) {
    if (!isKey(body.icon)) return fail('icon');
    value.icon = body.icon;
  }
  if (body.color !== undefined) {
    if (!isKey(body.color)) return fail('color');
    value.color = body.color;
  }
  if (body.archived !== undefined) {
    if (typeof body.archived !== 'boolean') return fail('archived');
    value.archived = body.archived;
  }
  return { ok: true, value };
}

/** 並べ替えの本文: `{ categoryIds: [...] }`。グループの全費目（アーカイブ済みも含む）を、並べたい順に。重複なし。 */
export function parseCategoryOrder(body: Record<string, unknown>): ParseResult<string[]> {
  const extra = unknownKey(body, ['categoryIds']);
  if (extra !== null) return fail(extra);
  const ids = body.categoryIds;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > MAX_CATEGORIES_PER_GROUP ||
    !ids.every(isId) ||
    new Set(ids).size !== ids.length
  ) {
    return fail('categoryIds');
  }
  return { ok: true, value: [...ids] };
}

/** 割合の見直しの確認の入力。 */
export interface ResetAcknowledgementInput {
  /** アプリが割合を見た月。この月に使われている行（その月以前で最も新しい行）の印だけを消す */
  month: string;
  /** アプリが見た、最も新しい `memberChangedAt`。それより新しい印は消さない */
  through: number;
}

/**
 * 割合の見直しの確認の本文: `{ month, through }`。`month` は `YYYY-MM`、`through` は0以上の整数（Unixエポックのミリ秒）。
 * 何を消すかは `handleAcknowledgeSharesReset`。
 */
export function parseResetAcknowledgement(body: Record<string, unknown>): ParseResult<ResetAcknowledgementInput> {
  const extra = unknownKey(body, ['month', 'through']);
  if (extra !== null) return fail(extra);
  if (!isMonth(body.month)) return fail('month');
  const through = body.through;
  if (typeof through !== 'number' || !Number.isSafeInteger(through) || through < 0) return fail('through');
  return { ok: true, value: { month: body.month, through } };
}

/** 「全費目を均等にする」の入力。 */
export interface EqualResetInput {
  /** アプリが割合を見ている月。この月と、それより後で割合の行がある月を、均等にする */
  month: string;
}

/** 「全費目を均等にする」の本文: `{ month }`。`month` は `YYYY-MM`。何を書くかは `handleResetSharesToEqual`。 */
export function parseEqualReset(body: Record<string, unknown>): ParseResult<EqualResetInput> {
  const extra = unknownKey(body, ['month']);
  if (extra !== null) return fail(extra);
  if (!isMonth(body.month)) return fail('month');
  return { ok: true, value: { month: body.month } };
}

/**
 * 負担割合の本文: `{ shares: [{ memberId, basisPoints }], cap?: { memberId, capMinor } | null }`。
 * 割合は0〜10000で、合計は10000（2章）。上限額つきでなければ `cap` は無いか null。上限額は1〜10^12。`currencyCode` は任意。
 * 上限を負担する人が、割合の中にいること（3章）は、メンバーを知っている呼び出し側で見る前に、ここでも見る。
 */
export function parseCategoryRule(body: Record<string, unknown>): ParseResult<CategoryRuleInput> {
  const extra = unknownKey(body, ['shares', 'cap', 'currencyCode']);
  if (extra !== null) return fail(extra);
  if (body.currencyCode !== undefined && !isCurrencyCodeShape(body.currencyCode)) return fail('currencyCode');
  const currencyCode = body.currencyCode === undefined ? null : body.currencyCode;
  if (!Array.isArray(body.shares) || body.shares.length === 0) return fail('shares');
  const shares: MemberShare[] = [];
  for (const item of body.shares as unknown[]) {
    if (!isRecord(item) || unknownKey(item, ['memberId', 'basisPoints']) !== null) return fail('shares');
    const { memberId, basisPoints } = item;
    if (!isId(memberId) || typeof basisPoints !== 'number' || !Number.isInteger(basisPoints)) return fail('shares');
    if (basisPoints < 0 || basisPoints > BASIS_POINTS_TOTAL) return fail('shares');
    shares.push({ memberId, basisPoints });
  }
  if (new Set(shares.map((share) => share.memberId)).size !== shares.length) return fail('shares');
  if (shares.reduce((sum, share) => sum + share.basisPoints, 0) !== BASIS_POINTS_TOTAL) return fail('shares');

  if (body.cap === undefined || body.cap === null) return { ok: true, value: { shares, cap: null, currencyCode } };
  if (!isRecord(body.cap) || unknownKey(body.cap, ['memberId', 'capMinor']) !== null) return fail('cap');
  const { memberId, capMinor } = body.cap;
  if (!isId(memberId)) return fail('cap.memberId');
  if (typeof capMinor !== 'number' || !Number.isSafeInteger(capMinor) || capMinor < 1 || capMinor > MAX_AMOUNT_MINOR) {
    return fail('cap.capMinor');
  }
  if (!shares.some((share) => share.memberId === memberId)) return fail('cap.memberId');
  return { ok: true, value: { shares, cap: { memberId, capMinor }, currencyCode } };
}
