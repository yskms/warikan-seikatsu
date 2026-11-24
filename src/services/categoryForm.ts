// カテゴリの編集の入力の規則（docs/screens.md 6章「カテゴリの編集」）。画面（RN）には依存しない（`npm test` で守る）。
// ここでするのは、入力の形の検査と、リクエストの組み立てだけ。**負担額の計算・端数の配り方はしない**（CLAUDE.md。Workerだけが
// 持つ）。均等の初期値（`equalPercents`）と割合の文字の読み書き（`percentText`・`parsePercent`）は、支出のシートと同じもの
// （`expenseForm.ts`）を使う。
//
// 保存は、名前・アイコン・色（`PATCH /categories/:id`）と、負担割合・上限額（`PUT .../category-shares/:categoryId`）の
// 2つの呼び出しになる。どちらも、変えたものがあるときだけ送る（`buildSavePlan`）。
import { BASIS_POINTS_TOTAL, type CategoryShareRule } from '../domain/categoryShare.ts';
import type { Category } from '../domain/month.ts';
import type { UpdateCategoryInput } from '../repositories/categoryRepository.ts';
import type { SaveShareInput } from '../repositories/categorySharesRepository.ts';
import { CATEGORY_ICON_KEYS } from '../theme/categoryIcons.ts';
import { palette } from '../theme/palette.ts';
import { amountState, expressionFromAmount } from './amountExpression.ts';
import { equalPercents, parsePercent, percentText } from './expenseForm.ts';

/** カテゴリの名前の長さの上限（前後の空白を落としたあと、コードポイントで数える。Workerの `MAX_CATEGORY_NAME_LENGTH`） */
export const MAX_CATEGORY_NAME_LENGTH = 20;

/** 選べる色のキー（メンバーの色と同じ10色。`src/theme/palette.ts`） */
export const CATEGORY_COLOR_KEYS = Object.keys(palette);

/** 割合の入力の既定の候補（2人のとき。先頭の人の割合。残りは、もう1人） */
export const RATIO_PRESETS = [5000, 6000, 7000, 8000, 10000] as const;

export interface CategoryDraft {
  name: string;
  icon: string;
  color: string;
  /** メンバーごとの割合（%の入力欄の文字） */
  percents: Record<string, string>;
  /** 上限額つきにするか */
  capEnabled: boolean;
  /** 上限まで負担する人 */
  capMemberId: string | null;
  /** 上限額（月あたり。入力欄の文字。通貨の単位で） */
  capAmount: string;
  /**
   * 上限額をつける直前の割合。つけたあとに切ったら、これに戻す（試しにスイッチを入れて切っただけで、割合が書き換わって
   * 「変更あり」にならないように）。開いたときから上限つきの費目は、つける前の割合を知らないので `null`（切っても、いまの値のまま）。
   */
  percentsBeforeCap: Record<string, string> | null;
  /** 上限額を切る直前の、上限つきの入力。また入れたら、これに戻す（元の「超えた分」の割合を、初期値で上書きしない） */
  cappedMemory: { percents: Record<string, string>; capMemberId: string | null; capAmount: string } | null;
}

export interface CategoryFormContext {
  /** 割合に入るメンバー（表示順。`orderShareMembers`）。負担割合を直せるときだけ意味がある */
  memberOrder: readonly string[];
  minorUnit: number;
  currencyCode: string;
  /** 編集で開いたカテゴリ。新しく作るときは `null` */
  editing: Category | null;
  /** 開いた月の、そのカテゴリの割合。無ければ（作る前の月、新規）`null`で、割合は編集できない */
  rule: CategoryShareRule | null;
  /** その月の割合を直せるか（`CategoryShares.editable`） */
  shareEditable: boolean;
}

/** 割合を編集できるか（その月に割合があり、直せる月） */
export function canEditShares(ctx: CategoryFormContext): boolean {
  return ctx.editing !== null && ctx.rule !== null && ctx.shareEditable && ctx.memberOrder.length > 0;
}

/** 新しいカテゴリの初期値。アイコン・色は、既存のカテゴリと重ならないものを先に選ぶ（すべて使われていたら、先頭）。 */
export function newDraft(existing: readonly Category[]): CategoryDraft {
  const usedIcons = new Set(existing.map((category) => category.icon));
  const usedColors = new Set(existing.map((category) => category.color));
  return {
    name: '',
    icon: CATEGORY_ICON_KEYS.find((key) => !usedIcons.has(key)) ?? CATEGORY_ICON_KEYS[0]!,
    color: CATEGORY_COLOR_KEYS.find((key) => !usedColors.has(key)) ?? CATEGORY_COLOR_KEYS[0]!,
    percents: {},
    capEnabled: false,
    capMemberId: null,
    capAmount: '',
    percentsBeforeCap: null,
    cappedMemory: null,
  };
}

/** 編集で開いたカテゴリの、いまの値。 */
export function draftFromCategory(
  category: Category,
  rule: CategoryShareRule | null,
  ctx: Pick<CategoryFormContext, 'memberOrder' | 'minorUnit'>,
): CategoryDraft {
  const cap = rule?.cap ?? null;
  const percents: Record<string, string> = {};
  for (const memberId of ctx.memberOrder) {
    percents[memberId] = percentText(rule?.shares.find((share) => share.memberId === memberId)?.basisPoints ?? 0);
  }
  return {
    name: category.name,
    icon: category.icon,
    color: category.color,
    percents,
    capEnabled: cap !== null,
    capMemberId: cap?.memberId ?? null,
    capAmount: cap === null ? '' : expressionFromAmount(cap.capMinor, ctx.minorUnit),
    percentsBeforeCap: null,
    cappedMemory: null,
  };
}

// --- 割合の操作 ---

/** 2人のとき、先頭の人の割合を決める（残りは、もう1人）。 */
export function applyPreset(draft: CategoryDraft, ctx: Pick<CategoryFormContext, 'memberOrder'>, firstBasisPoints: number): CategoryDraft {
  const [first, second] = ctx.memberOrder;
  if (ctx.memberOrder.length !== 2 || first === undefined || second === undefined) return draft;
  return {
    ...draft,
    percents: { ...draft.percents, [first]: percentText(firstBasisPoints), [second]: percentText(BASIS_POINTS_TOTAL - firstBasisPoints) },
  };
}

/** 全員を均等にする（端数は、先頭のメンバーから 0.01% ずつ。入力の初期値にするだけで、負担額の計算ではない）。 */
export function applyEqual(draft: CategoryDraft, ctx: Pick<CategoryFormContext, 'memberOrder'>): CategoryDraft {
  return { ...draft, percents: { ...draft.percents, ...equalPercents(ctx.memberOrder) } };
}

/**
 * 1人の割合の入力欄を直す。2人のときは、もう1人を残り（100% から引いた値）にする（空・読めない値・100%超のときは、もう1人は
 * 変えない）。3人以上は、その人の欄だけ。数字と小数点だけを通す（形の検査は、保存の前に `parsePercent`）。
 */
export function setPercentText(draft: CategoryDraft, ctx: Pick<CategoryFormContext, 'memberOrder'>, memberId: string, text: string): CategoryDraft {
  // 小数点が「,」のキーボードの `33,5` は、`33.5` にする
  const cleaned = text.replace(/,/g, '.').replace(/[^0-9.]/g, '');
  const percents = { ...draft.percents, [memberId]: cleaned };
  if (ctx.memberOrder.length === 2) {
    const other = ctx.memberOrder.find((id) => id !== memberId);
    // 空は、書き直している途中（もう1人を100%に跳ねさせない）。読めない値・100%超も、もう1人は変えない
    const basisPoints = cleaned === '' ? null : parsePercent(cleaned);
    if (other !== undefined && basisPoints !== null) percents[other] = percentText(BASIS_POINTS_TOTAL - basisPoints);
  }
  return { ...draft, percents };
}

/**
 * 上限額つきにする。超えた分の割合の初期値は、上限まで負担する人を0%、残りを均等にする（docs/screens.md 6章）。
 * 上限まで負担する人の初期値は、先頭（本人）。**いったん切った上限つきの入力があれば、それに戻す**（元の「超えた分」の割合や
 * 上限額を、初期値で上書きしない）。つける直前の割合は、切ったときに戻すために持つ（`disableCap`）。
 */
export function enableCap(draft: CategoryDraft, ctx: Pick<CategoryFormContext, 'memberOrder'>): CategoryDraft {
  if (draft.capEnabled) return draft;
  const before = draft.percents;
  if (draft.cappedMemory !== null) {
    return {
      ...draft,
      capEnabled: true,
      percents: draft.cappedMemory.percents,
      capMemberId: draft.cappedMemory.capMemberId,
      capAmount: draft.cappedMemory.capAmount,
      percentsBeforeCap: before,
      cappedMemory: null,
    };
  }
  const capMemberId = draft.capMemberId ?? ctx.memberOrder[0] ?? null;
  return withCapOverflow({ ...draft, capEnabled: true, capMemberId, percentsBeforeCap: before }, ctx);
}

/**
 * 上限額を切る。割合は、つける直前の値に戻す（開いたときから上限つきで、つける前の値を知らないときは、いまの値のまま。
 * 画面に出ている欄を見て、直してもらう）。上限つきの入力は、また入れたときのために持っておく。
 */
export function disableCap(draft: CategoryDraft): CategoryDraft {
  if (!draft.capEnabled) return draft;
  return {
    ...draft,
    capEnabled: false,
    percents: draft.percentsBeforeCap ?? draft.percents,
    percentsBeforeCap: null,
    cappedMemory: { percents: draft.percents, capMemberId: draft.capMemberId, capAmount: draft.capAmount },
  };
}

/** 上限まで負担する人を変える。超えた分の割合も、新しい人を0%・残りを均等に直す（入れ替えたとき、前の割合が残らない）。 */
export function setCapMember(draft: CategoryDraft, ctx: Pick<CategoryFormContext, 'memberOrder'>, memberId: string): CategoryDraft {
  return withCapOverflow({ ...draft, capMemberId: memberId }, ctx);
}

function withCapOverflow(draft: CategoryDraft, ctx: Pick<CategoryFormContext, 'memberOrder'>): CategoryDraft {
  const others = ctx.memberOrder.filter((id) => id !== draft.capMemberId);
  const percents: Record<string, string> = { ...draft.percents };
  if (draft.capMemberId !== null) percents[draft.capMemberId] = '0';
  // 残りが0人（1人だけのグループ）なら、その人が全部。残りが複数なら均等
  if (others.length === 0 && draft.capMemberId !== null) percents[draft.capMemberId] = percentText(BASIS_POINTS_TOTAL);
  Object.assign(percents, equalPercents(others));
  return { ...draft, percents };
}

// --- 検査 ---

export type DraftCheck =
  | { ok: true; name: string; shares: SaveShareInput['shares'] | null; cap: SaveShareInput['cap'] }
  | { ok: false; message: string };

function nameOf(text: string): string {
  return text.trim();
}

/** 入力の形の検査。割合を編集できないとき（`canEditShares` でない）は、名前だけを見る。 */
export function checkDraft(draft: CategoryDraft, ctx: CategoryFormContext): DraftCheck {
  const name = nameOf(draft.name);
  const length = Array.from(name).length;
  if (length === 0) return { ok: false, message: '名前を入力してください。' };
  if (length > MAX_CATEGORY_NAME_LENGTH) return { ok: false, message: `名前は${MAX_CATEGORY_NAME_LENGTH}文字までです。` };
  if (!canEditShares(ctx)) return { ok: true, name, shares: null, cap: null };

  const shares: SaveShareInput['shares'] = [];
  let total = 0;
  for (const memberId of ctx.memberOrder) {
    const basisPoints = parsePercent(draft.percents[memberId] ?? '');
    if (basisPoints === null) return { ok: false, message: '割合は、0〜100の数字で入力してください。' };
    shares.push({ memberId, basisPoints });
    total += basisPoints;
  }
  if (total !== BASIS_POINTS_TOTAL) {
    return { ok: false, message: `合計が100%になるように入力してください（いま ${percentText(total)}%）。` };
  }

  if (!draft.capEnabled) return { ok: true, name, shares, cap: null };
  if (draft.capMemberId === null || !ctx.memberOrder.includes(draft.capMemberId)) {
    return { ok: false, message: '上限まで負担する人を選んでください。' };
  }
  const amount = amountState(draft.capAmount, ctx.minorUnit);
  switch (amount.kind) {
    case 'ok':
      return { ok: true, name, shares, cap: { memberId: draft.capMemberId, capMinor: amount.minor } };
    case 'empty':
      return { ok: false, message: '上限額を入力してください。' };
    case 'too-large':
      return { ok: false, message: '上限額が大きすぎます。' };
    default:
      return { ok: false, message: '上限額は、0より大きい金額で入力してください。' };
  }
}

// --- 保存の組み立て ---

export interface SavePlan {
  /** 名前・アイコン・色で、変えたもの。変えていなければ `null`（送らない） */
  profile: UpdateCategoryInput | null;
  /** 割合・上限額。変えていなければ `null`（送らない） */
  shares: SaveShareInput | null;
}

function sameShares(rule: CategoryShareRule, shares: SaveShareInput['shares'], cap: SaveShareInput['cap']): boolean {
  const original = new Map(rule.shares.map((share) => [share.memberId, share.basisPoints]));
  if (original.size !== shares.length) return false;
  if (!shares.every((share) => original.get(share.memberId) === share.basisPoints)) return false;
  if (rule.cap === null || cap === null) return rule.cap === cap;
  return rule.cap.memberId === cap.memberId && rule.cap.capMinor === cap.capMinor;
}

/**
 * 編集の保存で送るもの。検査に通った入力と、開いたときの値を比べて、変えたものだけにする（変えていないものを送り直すと、
 * 他のメンバーが先に変えた値を、古い値で上書きする）。`ctx.editing` が `null` のとき（新規）は使わない。
 */
export function buildSavePlan(check: Extract<DraftCheck, { ok: true }>, draft: CategoryDraft, ctx: CategoryFormContext): SavePlan {
  const original = ctx.editing;
  if (original === null) return { profile: null, shares: null };
  const profile: UpdateCategoryInput = {};
  if (check.name !== original.name) profile.name = check.name;
  if (draft.icon !== original.icon) profile.icon = draft.icon;
  if (draft.color !== original.color) profile.color = draft.color;
  const shares =
    check.shares === null || ctx.rule === null || sameShares(ctx.rule, check.shares, check.cap)
      ? null
      : { shares: check.shares, cap: check.cap, currencyCode: check.cap === null ? null : ctx.currencyCode };
  return { profile: Object.keys(profile).length === 0 ? null : profile, shares };
}

/** 新しいカテゴリを作るための入力（名前・アイコン・色。割合は、サーバーが均等で作る） */
export function buildCreateInput(check: Extract<DraftCheck, { ok: true }>, draft: CategoryDraft): { name: string; icon: string; color: string } {
  return { name: check.name, icon: draft.icon, color: draft.color };
}

/** 送る変更があるか。無ければ、保存を押しても何も送らず、シートを閉じるだけ（保存ボタンは、押せるままにしている）。 */
export function hasChanges(plan: SavePlan): boolean {
  return plan.profile !== null || plan.shares !== null;
}

/**
 * 開いたとき（または、名前などが保存できたとき）の入力から、変えたか。閉じるときの破棄の確認に使う。上限額のスイッチを入れて
 * 切っただけ、のような、元に戻った操作は「変えた」と数えない（`percentsBeforeCap`・`cappedMemory` は見ない。上限が切れていれば、
 * 上限の人・上限額も見ない）。
 */
export function isDirty(draft: CategoryDraft, baseline: CategoryDraft): boolean {
  if (draft.name !== baseline.name || draft.icon !== baseline.icon || draft.color !== baseline.color) return true;
  if (JSON.stringify(sortedEntries(draft.percents)) !== JSON.stringify(sortedEntries(baseline.percents))) return true;
  if (draft.capEnabled !== baseline.capEnabled) return true;
  return draft.capEnabled && (draft.capMemberId !== baseline.capMemberId || draft.capAmount !== baseline.capAmount);
}

function sortedEntries(record: Record<string, string>): [string, string][] {
  return Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}
