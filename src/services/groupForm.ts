// グループ作成のフォームの検査（docs/screens.md 2章）。送る前に画面で見分けて、直す場所を示す。
// 検査の規則は、Workerの `parseLabel`（`worker/src/textInput.ts`）と同じ: 前後の空白を落として、1文字以上・上限以下
// （コードポイントで数える）で、制御文字を含まない。サーバーが最後の判定をするので、ここで通ったものが400になるのは、
// 規則が食い違ったとき（アプリの不具合）だけ。
import {
  CURRENCIES,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_GROUP_NAME_LENGTH,
} from '../domain/group.ts';

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

export interface CreateGroupForm {
  name: string;
  displayName: string;
  currencyCode: string;
}

export interface CreateGroupFormErrors {
  name?: string;
  displayName?: string;
  currencyCode?: string;
}

export type CreateGroupFormResult =
  | { ok: true; value: CreateGroupForm }
  | { ok: false; errors: CreateGroupFormErrors };

function checkLabel(text: string, maxLength: number, emptyMessage: string, longMessage: string): string | null {
  const trimmed = text.trim();
  if (trimmed === '') return emptyMessage;
  if ([...trimmed].length > maxLength) return longMessage;
  if (CONTROL_CHARACTERS.test(trimmed)) return '使えない文字が含まれています。';
  return null;
}

export type DisplayNameResult = { ok: true; value: string } | { ok: false; error: string };

/**
 * 表示名（このグループの中での名前）の検査。グループの作成と、招待を受けての参加（`POST /invites/:token/join`）が、同じ規則を使う。
 * 通ったときは、前後の空白を落とした値を返す（そのまま送れる）。
 */
export function validateDisplayName(displayName: string): DisplayNameResult {
  const error = checkLabel(
    displayName,
    MAX_DISPLAY_NAME_LENGTH,
    '表示名を入力してください。',
    `表示名は${MAX_DISPLAY_NAME_LENGTH}文字までです。`,
  );
  return error === null ? { ok: true, value: displayName.trim() } : { ok: false, error };
}

/** 通ったときは、前後の空白を落とした値を返す（そのまま送れる）。 */
export function validateCreateGroupForm(form: CreateGroupForm): CreateGroupFormResult {
  const errors: CreateGroupFormErrors = {};
  const nameError = checkLabel(
    form.name,
    MAX_GROUP_NAME_LENGTH,
    'グループ名を入力してください。',
    `グループ名は${MAX_GROUP_NAME_LENGTH}文字までです。`,
  );
  if (nameError) errors.name = nameError;
  const displayNameResult = validateDisplayName(form.displayName);
  if (!displayNameResult.ok) errors.displayName = displayNameResult.error;
  if (!CURRENCIES.some((currency) => currency.code === form.currencyCode)) {
    errors.currencyCode = '通貨を選んでください。';
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { name: form.name.trim(), displayName: form.displayName.trim(), currencyCode: form.currencyCode },
  };
}
