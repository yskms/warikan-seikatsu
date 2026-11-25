// キーパッドの並び（アプリの設定）を、画面から読む。変わったら、キーパッドが描き直される。
import { useSyncExternalStore } from 'react';

import { keypadLayoutPreference } from '../platform/keypadLayout.ts';
import { DEFAULT_KEYPAD_LAYOUT, type KeypadLayout } from '../src/services/keypadLayout.ts';

export function useKeypadLayout(): KeypadLayout {
  return useSyncExternalStore(keypadLayoutPreference.subscribe, keypadLayoutPreference.get, () => DEFAULT_KEYPAD_LAYOUT);
}
