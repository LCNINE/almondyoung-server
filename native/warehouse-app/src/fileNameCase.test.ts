import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

// Windows 빌드는 대소문자만 다른 두 파일을 같은 파일로 읽는다 — 리눅스 게이트에서는 통과해도 설치본 빌드가 깨진다
it('대소문자만 다른 파일 이름이 한 폴더에 없다', () => {
  const clashes: string[] = [];
  const walk = (dir: string) => {
    const entries = readdirSync(dir, { withFileTypes: true });
    const seen = new Map<string, string>();
    for (const entry of entries) {
      const stem = entry.name.replace(/\.(tsx?|jsx?)$/, '').toLowerCase();
      const other = seen.get(stem);
      if (other) clashes.push(`${join(dir, other)} ↔ ${join(dir, entry.name)}`);
      else seen.set(stem, entry.name);
      if (entry.isDirectory()) walk(join(dir, entry.name));
    }
  };
  walk(join(import.meta.dirname, '.'));
  expect(clashes).toEqual([]);
});
