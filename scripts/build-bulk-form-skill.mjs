// 스킬을 claude.ai 업로드용 zip 으로 묶는다.
//
// claude.ai 커스텀 스킬은 **사용자별 zip 업로드**이고 관리자 배포가 없다. 그래서 MD 각자가
// 이 파일을 받아 올려야 하고, 갱신 때도 각자 다시 올려야 한다. SKILL.md 의 버전이 낡은
// zip 을 쓰는 사람을 찾아내는 유일한 수단이다.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SKILL = join(ROOT, 'skills', 'product-bulk-form');
const DIST = join(ROOT, 'dist');

const skillMd = readFileSync(join(SKILL, 'SKILL.md'), 'utf8');
const version = /스킬 버전:\s*([0-9]+\.[0-9]+\.[0-9]+)/.exec(skillMd)?.[1];
if (!version) throw new Error('SKILL.md 에서 "스킬 버전: x.y.z" 를 찾지 못했습니다.');

mkdirSync(DIST, { recursive: true });
const out = join(DIST, `product-bulk-form-${version}.zip`);

// 테스트·가상환경·캐시는 빼고 스킬 본체만 담는다.
try {
  execFileSync(
    'zip',
    [
      '-r',
      out,
      'product-bulk-form',
      '-x',
      '*/.venv/*',
      '*/tests/*',
      '*/requirements-dev.txt',
      '*/__pycache__/*',
      '*/.pytest_cache/*',
    ],
    { cwd: join(ROOT, 'skills'), stdio: 'inherit' },
  );
} catch (err) {
  if (err.code === 'ENOENT') {
    throw new Error('zip 커맨드를 찾을 수 없습니다. (Ubuntu/Debian: apt install zip / macOS: 기본 설치됨)');
  }
  throw err;
}
console.log(`\n빌드 완료: ${out}`);
