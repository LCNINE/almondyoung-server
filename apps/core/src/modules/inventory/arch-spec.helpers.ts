import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/** 디렉터리 아래 `.ts` 파일(스펙 제외)을 재귀로 모은다. */
export function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectTsFiles(full));
      continue;
    }
    if (!entry.endsWith('.ts') || entry.endsWith('.spec.ts')) continue;
    out.push(full);
  }
  return out;
}

/**
 * 파일 안의 모든 모듈 지정자: `from '…'` (import·re-export, 줄바꿈 무관) · `require('…')` ·
 * `import('…')` (동적) · `import '…'` (부수효과 전용, `from` 없는 bare import).
 */
export function moduleSpecifiers(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const specifiers: string[] = [];
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

/**
 * 파일을 읽어 `/* … *\/` 블록·`// …` 라인 주석을 지운 텍스트를 돌려준다(문서 안의 키워드 오탐 방지).
 * `//` 제거는 문자열 리터럴을 모른다 — 같은 줄의 문자열 안에 `//` 가 있으면 그 지점부터 줄 나머지가
 * 함께 잘려나간다.
 */
export function readCodeWithoutComments(file: string): string {
  const source = readFileSync(file, 'utf8');
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}
