// 「ログイン済みか」を、画面全体で共有する。`app/_layout.tsx` が、これを見て、ログイン画面とメインを切り替える
// （`Stack.Protected`）。判定の仕様は docs/screens.md 1章の最後の項目、読み直しの規則は `src/services/sessionCheck.ts`。
// 名前は `AuthStateProvider`: `AuthProvider` は、ログイン手段（apple・google）の型の名前（`src/domain/types.ts`。Singfolioのコピー）。
//
// **この状態は、端末のセッションとは別に持っている。** セッションが無くなったとき（401・ログアウト・アカウントの削除）に
// ずれないよう、`platform/accountService.ts` が `accountService`・`sessionAccess` を包み、`onSessionLost` で通知する
// （`src/services/sessionLost.ts`）。ここで受けて、ログイン画面へ戻す。**ログアウト側（セッションが無くなったこと）は、
// 画面・APIを呼ぶ層から状態を直接変えない**（個別に呼ぶと漏れる）。認証が要るAPIは、必ず `sessionAccess.withSession` を
// 通すこと。**ログイン済みにする側は別**: ログイン画面が、`signIn` の成功（と `already-signed-in`）で `markSignedIn` を呼ぶ。
// ログインの成否は、その場で分かるので、通知に寄せない（`markSignedIn` を外さない）。
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { accountService, onSessionLost } from '../platform/accountService.ts';
import { checkSession, checkSessionOnce, type SessionCheck } from '../src/services/sessionCheck.ts';

export type AuthState =
  /** 端末のログイン情報を調べている（画面は何も出さない） */
  | { status: 'checking' }
  /**
   * ログインしていない。`unreadable` は、端末の保存先を読めなかった（読み直しても直らなかった）ことを表す。
   * ログイン画面を出す。ログインすれば、読めない値は上書きされる。
   */
  | { status: 'signed-out'; unreadable: boolean }
  | { status: 'signed-in' };

interface AuthContextValue {
  state: AuthState;
  /** ログインが済んだ（`accountService.signIn` が成功した、または `already-signed-in` だった）。 */
  markSignedIn(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function fromCheck(check: SessionCheck): AuthState {
  switch (check) {
    case 'signed-in':
      return { status: 'signed-in' };
    case 'signed-out':
      return { status: 'signed-out', unreadable: false };
    case 'unreadable':
      return { status: 'signed-out', unreadable: true };
  }
}

export function AuthStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'checking' });

  // 起動時。保存先を読めないときは、短い間隔で数回読み直す（`checkSession`）。
  useEffect(() => {
    let cancelled = false;
    void checkSession(accountService).then((check) => {
      if (!cancelled) setState(fromCheck(check));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 読めないままログイン画面を出しているあいだ、アプリが前面に戻ったときに、もう一度読む（端末のロックを解除して
  // 戻ってきたときなど）。結果は、まだ「読めないままのログイン画面」のときだけ反映する: 読んでいるあいだに
  // ログインが済んだ（`markSignedIn`）のに、古い「ログインしていない」で上書きしない。
  //
  // 取りこぼすことがある: 登録は `unreadable` に決まったあとなので、起動時の読み直し（最長約3.5秒）の途中で前面に戻り、
  // 最後の読み直しがその直前に失敗したときは、次に前面に戻るまで読み直さない。直さないでよいと判断した（登録の時点で
  // 1回読むと、起動の判定の直後に、同じ読み込みを毎回もう1回する）。ログイン画面で、組み込み済みの手段のボタンを押せば、`signIn` が先に保存済みの
  // セッションを読み、見つかれば `already-signed-in` になって、そのままメインへ進む（各社の画面は開かない）。
  const unreadable = state.status === 'signed-out' && state.unreadable;
  useEffect(() => {
    if (!unreadable) return;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      void checkSessionOnce(accountService).then((check) => {
        if (check === 'unreadable') return;
        setState((current) =>
          current.status === 'signed-out' && current.unreadable ? fromCheck(check) : current,
        );
      });
    });
    return () => subscription.remove();
  }, [unreadable]);

  // 端末のセッションが無くなった（上の説明）。ログイン画面へ戻る。
  useEffect(
    () => onSessionLost(() => setState({ status: 'signed-out', unreadable: false })),
    [],
  );

  const markSignedIn = useCallback(() => setState({ status: 'signed-in' }), []);
  const value = useMemo(() => ({ state, markSignedIn }), [state, markSignedIn]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth は AuthStateProvider の中で使う');
  return value;
}
