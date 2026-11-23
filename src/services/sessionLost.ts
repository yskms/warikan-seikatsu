// 端末のセッションが無くなったことを、画面（ログイン状態）へ知らせる。
// `accountService` は、端末のセッションを捨てても（401を受けた、ログアウト、アカウントの削除）、画面へは知らせない
// （Singfolioのコピーを元にした構造を保つため、通知の仕組みを足していない）。画面のログイン状態（`ui/AuthStateProvider.tsx`）は
// 別に持っているので、ずれると、ログインしていないのにメインの画面が出続ける。そこで、`accountService`・`sessionAccess` を
// 包み、**1か所で**通知する。画面・APIを呼ぶ層は、個別に通知しない（漏れる）。
//
// 通知する場合:
// - `signOut` が成功した（端末の値は捨ててある。捨てられなければ `storage-failed` で投げるので、通知しない）。
// - `deleteAccount` が成功し、端末のセッションも捨てられた（`sessionCleared`）。捨てられなかったときは、アカウントは
//   消えたが端末はまだサインイン中のまま: 画面が案内を出すので、通知しない（次のAPIの呼び出しが 401 になり、そこで通知する）。
// - `deleteAccount`・`withSession` が、`unauthorized`（サーバーがセッションを認めなかった。層が端末のセッションを捨てる）か
//   `not-signed-in` を投げた。失敗は、そのまま投げ直す。
// 通知しない: `storage-failed`（読めない・消せない。セッションが無くなったとは限らない）、通信の失敗、5xx。
//
// 注意: `unauthorized` のとき、層が端末のセッションを捨てるのに失敗することがある（まれ）。通知するので、画面はログイン画面へ
// 移るが、端末には値が残っていて、ログインを押すと `already-signed-in` になり、メインへ戻る。次のAPIの呼び出しで、また 401 に
// なる（繰り返すが、ログアウトで抜けられる）。
import { AuthError } from '../repositories/authError.ts';
import type { AccountService, SessionAccess } from './accountService.ts';

export interface SessionLostNotifier {
  /** 画面へ渡す。`signOut`・`deleteAccount` が、成功したときに通知する。 */
  account: AccountService;
  /** APIを呼ぶ層へ渡す。 */
  access: SessionAccess;
  /** 通知を受ける。戻り値で解除する。 */
  subscribe(listener: () => void): () => void;
}

function isSessionLost(error: unknown): boolean {
  return error instanceof AuthError && (error.code === 'unauthorized' || error.code === 'not-signed-in');
}

export function withSessionLostNotice(account: AccountService, access: SessionAccess): SessionLostNotifier {
  const listeners = new Set<() => void>();
  function notify(): void {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // 受け取る側の失敗で、呼び出し元の結果を変えない
      }
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    account: {
      getSignedInProvider: () => account.getSignedInProvider(),
      signIn: (provider) => account.signIn(provider),
      async signOut() {
        const result = await account.signOut();
        notify();
        return result;
      },
      async deleteAccount() {
        try {
          const result = await account.deleteAccount();
          if (result.sessionCleared) notify();
          return result;
        } catch (error) {
          if (isSessionLost(error)) notify();
          throw error;
        }
      },
    },
    access: {
      async withSession<T>(task: (session: string) => Promise<T>): Promise<T> {
        try {
          return await access.withSession(task);
        } catch (error) {
          if (isSessionLost(error)) notify();
          throw error;
        }
      },
    },
  };
}
