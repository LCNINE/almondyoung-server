import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * 스펙 §5 «배치 시작 입구는 하나» — 명시적 시작 명령(`POST /picking/v2/starts`)만 배치를 시작한다.
 * `prepare` 가 첫 스캔의 부수효과로 배치를 시작하던 경로(지연 시작)가 되살아나면 송장 출력 전에 배정이
 * 바뀌는 구조로 돌아간다.
 */
const ROOT = join(__dirname, '../../../../../../..');
const SRC = join(ROOT, 'apps/core/src');

// 테스트 지원(`__support__`)은 명시적 시작을 대신 불러 주는 곳이라 대상이 아니다(`startBatchFor`).
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__support__' ? [] : walk(path);
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

function filesMatching(pattern: RegExp): string[] {
  return walk(SRC)
    .filter((path) => pattern.test(readFileSync(path, 'utf8')))
    .map((path) => relative(ROOT, path))
    .sort();
}

describe('배치 시작 입구', () => {
  it('startBatchPicking 을 부르는 곳은 PickingProcessService 하나뿐이다', () => {
    expect(filesMatching(/\bstartBatchPicking\(/)).toEqual([
      'apps/core/src/modules/fulfillment/picking/allocation/batch-start.ts',
      'apps/core/src/modules/fulfillment/services/picking-process.service.ts',
    ]);
  });

  it('PickingProcessService.start 를 부르는 곳은 시작 컨트롤러뿐이다', () => {
    expect(filesMatching(/\bpicking\.start\(/)).toEqual([
      'apps/core/src/modules/fulfillment/controllers/picking-v2.controller.ts',
    ]);
  });

  it('지연 시작의 잠금 헬퍼는 사라졌다', () => {
    expect(filesMatching(/\blockPreparation\b/)).toEqual([]);
  });
});
