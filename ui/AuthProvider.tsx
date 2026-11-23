// 「ログイン済みか」を、画面全体で共有する。`app/_layout.tsx` が、これを見て、ログイン画面とメインを切り替える
// （`Stack.Protected`）。判定の仕様は docs/screens.md 1章の最後の項目、読み直しの規則は `src/services/sessionCheck.ts`。
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { accountService } from '../platform/accountService.ts';
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

export function AuthProvider({ children }: { children: ReactNode }) {
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

  const markSignedIn = useCallback(() => setState({ status: 'signed-in' }), []);
  const value = useMemo(() => ({ state, markSignedIn }), [state, markSignedIn]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth は AuthProvider の中で使う');
  return value;
}
