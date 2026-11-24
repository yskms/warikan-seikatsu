// グループの設定の入力の検査と、保存の組み立て（docs/screens.md 6章の「グループの設定」）。画面は、入力欄を並べて、押されたものを
// 渡すだけ。入力の規則（長さ・使えない文字）は、グループの作成と同じ（`groupForm.ts`）。サーバーが最後の判定をする。
//
// **保存は、変えたものだけを送る**（全項目を送り直す形に「簡略化」しない）。他のメンバーが先に直したグループ名や、自分が別の端末で
// 直した表示名を、開いたときの古い値で上書きしないため。送り先は2つ（グループ名・通貨は `PATCH /groups/:id`、自分の表示名・色は
// `PATCH /groups/:id/members/me`）で、別の呼び出し。
import { CURRENCIES, MEMBER_COLORS, type GroupDetail } from '../domain/group.ts';
import type { UpdateGroupRequest, UpdateMeRequest } from '../repositories/groupRepository.ts';
import { validateDisplayName, validateGroupName } from './groupForm.ts';

/** 入力欄の値（まだ検査していない、打ったままの文字列を含む）。 */
export interface GroupSettingsDraft {
  name: string;
  displayName: string;
  /** メンバーの色のキー。知らないキー（サーバーが足した色）でも、そのまま持つ（変えなければ送らない） */
  color: string;
  currencyCode: string;
}

/** 何を変えられるか。サーバーの値（`leaveEffective`・`currencyLocked`）で決める。アプリは、規則を書き写さない。 */
export interface GroupSettingsAccess {
  /** グループ名と通貨を変えられるか。脱退が確定した人は、変えられない（サーバーが403）。自分の表示名と色は、いつも変えられる */
  canEditGroup: boolean;
  /** 通貨を変えられるか（`canEditGroup` で、かつ、金額に関わるものが無い） */
  canEditCurrency: boolean;
  /** 金額に関わるものがあって、通貨が固定されているか（サーバーの `currencyLocked`。変えられない理由の文言を分けるため） */
  currencyLocked: boolean;
}

export interface GroupSettingsContext {
  /** 読み込んだときの値（変えたかの判定と、送る差分のもと） */
  baseline: GroupSettingsDraft;
  access: GroupSettingsAccess;
}

/** 読み込んだグループから、入力の初期値と、変えられるものを作る。自分のメンバーが見つからなければ `null`。 */
export function contextOf(group: GroupDetail): GroupSettingsContext | null {
  const me = group.members.find((member) => member.id === group.memberId);
  if (me === undefined) return null;
  const canEditGroup = !me.leaveEffective;
  return {
    baseline: { name: group.name, displayName: me.displayName, color: me.color, currencyCode: group.currencyCode },
    access: { canEditGroup, canEditCurrency: canEditGroup && !group.currencyLocked, currencyLocked: group.currencyLocked },
  };
}

export interface GroupSettingsErrors {
  name?: string;
  displayName?: string;
  currencyCode?: string;
}

/** 保存で送る内容。送るものが無い呼び出しは、`null`（呼ばない）。 */
export interface GroupSettingsPlan {
  group: UpdateGroupRequest | null;
  me: UpdateMeRequest | null;
}

export type GroupSettingsCheck =
  | { ok: true; plan: GroupSettingsPlan }
  | { ok: false; errors: GroupSettingsErrors };

/**
 * 入力を検べて、保存で送る差分を組み立てる。変えていない項目は、検べず、送らない（読み込んだ値が、いまの規則で通らなくても、
 * 触っていない項目で保存を止めない）。変えられない項目（`access`）は、入力が変わっていても送らない。
 * 通ったときの値は、前後の空白を落としたもの。
 */
export function checkSettings(draft: GroupSettingsDraft, context: GroupSettingsContext): GroupSettingsCheck {
  const { baseline, access } = context;
  const errors: GroupSettingsErrors = {};
  const group: UpdateGroupRequest = {};
  const me: UpdateMeRequest = {};

  if (access.canEditGroup && draft.name.trim() !== baseline.name) {
    const result = validateGroupName(draft.name);
    if (result.ok) group.name = result.value;
    else errors.name = result.error;
  }
  if (access.canEditCurrency && draft.currencyCode !== baseline.currencyCode) {
    if (CURRENCIES.some((currency) => currency.code === draft.currencyCode)) group.currencyCode = draft.currencyCode;
    else errors.currencyCode = '通貨を選んでください。';
  }
  if (draft.displayName.trim() !== baseline.displayName) {
    const result = validateDisplayName(draft.displayName);
    if (result.ok) me.displayName = result.value;
    else errors.displayName = result.error;
  }
  if (draft.color !== baseline.color) {
    // 選べるのは、一覧の色だけ（サーバーも、一覧のキーしか通さない）
    if ((MEMBER_COLORS as readonly string[]).includes(draft.color)) me.color = draft.color;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    plan: {
      group: Object.keys(group).length > 0 ? group : null,
      me: Object.keys(me).length > 0 ? me : null,
    },
  };
}

/** 変えた入力があるか（✕・戻る操作の破棄の確認と、保存ボタンの出し分け）。空白だけの違いは、変えたことにしない。 */
export function isDirty(draft: GroupSettingsDraft, context: GroupSettingsContext): boolean {
  const { baseline, access } = context;
  return (
    (access.canEditGroup && draft.name.trim() !== baseline.name) ||
    (access.canEditCurrency && draft.currencyCode !== baseline.currencyCode) ||
    draft.displayName.trim() !== baseline.displayName ||
    draft.color !== baseline.color
  );
}

/**
 * 保存が済んだ部分を、読み込んだときの値に取り込む。2つの呼び出しの途中で失敗したとき、済んだほうを送り直さないため
 * （やり直しでは、残りの差分だけが組み立てられる）。
 */
export function applySaved(context: GroupSettingsContext, plan: GroupSettingsPlan, step: 'group' | 'me'): GroupSettingsContext {
  const baseline = { ...context.baseline };
  if (step === 'group' && plan.group !== null) {
    if (plan.group.name !== undefined) baseline.name = plan.group.name;
    if (plan.group.currencyCode !== undefined) baseline.currencyCode = plan.group.currencyCode;
  }
  if (step === 'me' && plan.me !== null) {
    if (plan.me.displayName !== undefined) baseline.displayName = plan.me.displayName;
    if (plan.me.color !== undefined) baseline.color = plan.me.color;
  }
  return { ...context, baseline };
}

/**
 * 読み直した内容（`fresh`）に、いまの入力を載せ直す（断られて、変えられるもの・基準が変わったと分かったとき）。入力は、項目ごとに:
 * 触っていない（読み込んだときの値のまま）なら、読み直した値にする（他のメンバーが直した名前を、古い値で表示しない）。
 * 触っていて、いまも変えられるなら、入力を残す（打ち直させない）。触っていても、もう変えられないなら、読み直した値にする
 * （脱退が確定した・通貨が固定された。変えられない欄に、送れない入力を残さない）。
 */
export function rebase(
  draft: GroupSettingsDraft,
  previous: GroupSettingsContext,
  fresh: GroupSettingsContext,
): GroupSettingsDraft {
  const { baseline: old } = previous;
  const { baseline: next, access } = fresh;
  const pick = <K extends keyof GroupSettingsDraft>(key: K, editable: boolean): GroupSettingsDraft[K] => {
    const touched = key === 'name' || key === 'displayName' ? draft[key].trim() !== old[key] : draft[key] !== old[key];
    return touched && editable ? draft[key] : next[key];
  };
  return {
    name: pick('name', access.canEditGroup),
    displayName: pick('displayName', true),
    color: pick('color', true),
    currencyCode: pick('currencyCode', access.canEditCurrency),
  };
}
