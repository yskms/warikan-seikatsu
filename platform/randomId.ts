// 作成の識別子（冪等キー）に使うUUID（v4。小文字）。WorkerはUUIDの小文字だけを通す（`isUuid`）。
// RN・Expoを import するので、Nodeのテストから実行する `src/` には置かない（CLAUDE.md）。
import { randomUUID } from 'expo-crypto';

export function newId(): string {
  return randomUUID().toLowerCase();
}
