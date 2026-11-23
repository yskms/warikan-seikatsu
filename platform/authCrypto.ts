// ログインに使う乱数とSHA-256の実体（expo-crypto）。`src/services/authCrypto.ts` の `CryptoPrimitives` を実装する。
// 形（43字のbase64url）に整えて確かめるのは `src/services/authCrypto.ts`。ここは、expo-crypto の呼び出しだけ。
// RN・Expoを import するので、Nodeのテストから実行する `src/` には置かない（CLAUDE.md）。
// Singfolio（src/services/index.ts の `getRandomBytes`・`digestStringAsync` の呼び出し）を元にした（コピー元: singfolio 9aaef21）。
import { CryptoDigestAlgorithm, CryptoEncoding, digestStringAsync, getRandomBytes } from 'expo-crypto';

import { createAuthCrypto, type CryptoPrimitives } from '../src/services/authCrypto.ts';

const primitives: CryptoPrimitives = {
  // OSの暗号論的に安全な乱数（Android: SecureRandom、iOS: SecRandomCopyBytes）。
  getRandomBytes: (length) => getRandomBytes(length),
  sha256Base64: (text) => digestStringAsync(CryptoDigestAlgorithm.SHA256, text, { encoding: CryptoEncoding.BASE64 }),
};

export const authCrypto = createAuthCrypto(primitives);
