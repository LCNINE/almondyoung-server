import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * K7 PR1(N5) — 취소 갈래는 «상자 전/후» 로 부른다. 옛 이름 V1/V2 는 현역인 상자 전 경로를 레거시처럼 보이게 했고,
 * 출고 파이프라인 버전(`assertV2MutationAllowed`)과도 헷갈렸다. 옛 이름이 되살아나면 빨갛다.
 * spec 도 훑는다(테스트 이름·단언 문구가 같은 어휘를 써야 한다). 다만 이 파일은 옛 이름을 정규식에 적으므로 제외한다.
 */
const ROOT = join(__dirname, '../../../../../..');
const SRC = join(ROOT, 'apps/core/src');
const SELF = __filename;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith('.ts') && path !== SELF ? [path] : [];
  });
}

function filesMatching(pattern: RegExp, under = 'apps/core/src'): string[] {
  return walk(join(ROOT, under))
    .filter((path) => pattern.test(readFileSync(path, 'utf8')))
    .map((path) => relative(ROOT, path))
    .sort();
}

describe('상자 전/후 이름', () => {
  it('옛 V1/V2 취소 이름이 없다', () =>
    expect(
      filesMatching(
        /hasV2FulfillmentHistory|cancelV2Outstanding|planV2Outstanding|findV2CancellationReplay|V2OutstandingPlan|explicitV2CancellationSourceKey|seedShippedV1Fulfillment|seedV2SetOrder|v2CancellationRequestHash|v2-cancellation-units|\bcancelPartial\b/,
        'apps/core/src',
      ),
    ).toEqual([]));

  it('판매주문 코드가 취소 갈래를 V1/V2 로 부르지 않는다', () =>
    expect(
      filesMatching(
        /V[12]\s*(전체|부분)?\s*취소|V[12] (sales-order )?cancellation|V[12] 경로|V1 엔진|V2 fulfillment (item|SKU)|V2 (component )?progress|V2 outstanding|V2 «|v[12] (partial|full)/i,
        'apps/core/src/modules/sales-order',
      ),
    ).toEqual([]));
});
