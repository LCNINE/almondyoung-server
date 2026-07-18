import * as fs from 'fs';
import * as path from 'path';

/**
 * Medusa 는 워크플로 훅 하나당 핸들러 하나만 허용한다.
 * 중복 등록하면 부팅 시 "Cannot define multiple hook handlers for the validate hook" 로 죽는다
 * — 타입체크도 단위테스트도 못 잡고 배포 후 컨테이너가 안 뜬다(2026-07-16 실제 발생).
 * 새 검증이 필요하면 새 훅을 등록하지 말고 기존 핸들러 안에 함수를 더할 것.
 */
const HOOKS_DIR = path.join(__dirname, '..');

function collectTsFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : collectTsFiles(full);
    }
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

describe('워크플로 훅 중복 등록 방지', () => {
  it('validate 훅은 워크플로당 한 번만 등록한다', () => {
    const registrations = new Map<string, string[]>();

    for (const file of collectTsFiles(HOOKS_DIR)) {
      const source = fs.readFileSync(file, 'utf8');
      const matches = source.matchAll(/(\w+Workflow)\.hooks\.(\w+)\s*\(/g);

      for (const [, workflow, hook] of matches) {
        const key = `${workflow}.${hook}`;
        registrations.set(key, [...(registrations.get(key) ?? []), path.basename(file)]);
      }
    }

    const duplicates = [...registrations.entries()].filter(([, files]) => files.length > 1);

    expect(duplicates).toEqual([]);
  });
});
