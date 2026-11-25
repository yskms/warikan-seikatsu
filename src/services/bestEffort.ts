// 補助の読み込み（画面の本体の表示に、なくても困らないもの）を、失敗しても本体を失敗にしないで読む。
// 使うところは列挙しない（足すたびに古くなる。`bestEffort(` で探す）。いまは、ホームの固定費のお知らせ・内訳の割合と、メンバーと
// 招待の脱退の欄の添え書き（docs/screens.md 3章・6章）。
//
// **401（`unauthorized`）だけは、握りつぶさずに投げる。** 認証が要る呼び出しの失敗は、`SessionAccess.withSession` が、401 のときだけ
// 端末のセッションを捨てて、画面のログイン状態へ伝える（CLAUDE.md）。補助の呼び出しだけが401になったとき（セッションが失効した
// ちょうどの境目）に握りつぶすと、本体の読み込みが成功して、セッション切れが伝わらない。それ以外の失敗（通信・5xx・応答の形の崩れ）
// は、補助が出ないだけで、画面は使える。
import { AuthError } from '../repositories/authError.ts';

export async function bestEffort<T>(task: Promise<T>): Promise<T | null> {
  try {
    return await task;
  } catch (e) {
    if (e instanceof AuthError && e.code === 'unauthorized') throw e;
    return null;
  }
}
