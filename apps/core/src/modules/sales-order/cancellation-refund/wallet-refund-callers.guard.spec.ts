import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * K7 PR4 — 취소가 Wallet 을 부르는 길은 `CancellationRefundManager` 하나다. 환불 방침 기록·실행·재시도·환불 안 함이
 * 한 파일에 모여 있어야 «누가 돈을 내보내나» 가 한 곳에서 보인다. 새 호출자가 생기면 빨갛게 한다.
 * 스펙·`__support__`·`__fixtures__` 는 테스트 데이터를 만들 뿐이라 대상이 아니다.
 */
const ROOT = join(__dirname, '../../../../../..');
const SRC = join(ROOT, 'apps/core/src');

function walk(path: string): string[] {
  if (statSync(path).isDirectory()) {
    return readdirSync(path).flatMap((name) =>
      name === '__support__' || name === '__fixtures__' ? [] : walk(join(path, name)),
    );
  }
  return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
}

function filesCalling(pattern: RegExp): string[] {
  return walk(SRC)
    .filter((path) => pattern.test(readFileSync(path, 'utf8')))
    .map((path) => relative(ROOT, path))
    .sort();
}

describe('Wallet 환불 호출자 (K7 PR4)', () => {
  it('refundByIntent 를 부르는 파일은 취소 환불 매니저뿐 — 반품 환불은 Medusa 가 낸다(K8)', () =>
    expect(filesCalling(/\.refundByIntent\(/)).toEqual([
      'apps/core/src/modules/sales-order/cancellation-refund/cancellation-refund.manager.ts',
    ]));
});
