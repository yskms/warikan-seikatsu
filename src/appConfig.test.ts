// app.json の識別子の整合。iOSとAndroidで同じIDを使う（ストア・ログインの設定がこのIDに結びつくため、
// 公開後は変えられない）。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const appJson = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));

test('iOSのbundleIdentifierとAndroidのpackageが同じ', () => {
  assert.equal(appJson.expo.ios.bundleIdentifier, 'com.yskms.warikanseikatsu');
  assert.equal(appJson.expo.android.package, appJson.expo.ios.bundleIdentifier);
});

// 入口は、ふだんの `expo-router/entry`。ストアのスクリーンショットを撮る間だけ、偽のサーバーの入口
// （`scripts/store-screenshots/fake-mode.sh on`）にするが、そのまま出荷すると、偽のデータだけを表示するアプリになる。
test('package.json の main が、ふだんの入口（偽のサーバーの入口ではない）', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(packageJson.main, 'expo-router/entry');
});

// R8（難読化・最適化・縮小）のplugin。外すと、2027年2月からGoogle Playが求める率を満たせない（CLAUDE.md）。
test('AndroidのR8を有効にするpluginが app.json に入っている', () => {
  assert.ok(appJson.expo.plugins.includes('./plugins/withAndroidR8.js'));
});
