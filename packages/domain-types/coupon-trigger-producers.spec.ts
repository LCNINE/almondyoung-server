import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AUTO_ISSUE_TRIGGERS } from './coupon-auto-issue-trigger';
import { COUPON_TRIGGER_SOURCES } from './coupon-trigger-sources';

/**
 * 가드 A (#775, ADR-0035): **트리거 어휘의 모든 값은 등록된 살아 있는 발행자를 가진다.**
 *
 * `coupon-vocabulary-drift.spec.ts` 와 같은 기법 — 소스를 텍스트로 읽어 대조한다. 루트 jest 는
 * `modulePathIgnorePatterns` 에 `/apps/medusa/` 가 있어 그 트리를 require 할 수 없고, CI 의 루트 `npm ci` 는
 * `apps/medusa/node_modules` 를 깔지 않는다. 그래서 「이벤트를 코어가 emit 하는가」 는 여기서 보지 않고
 * Medusa 유닛의 가드 B(`subscriber-events-have-emitters.unit.spec.ts`)가 본다. 둘이 한 사슬이다:
 * 트리거 → subscriber 파일 → 이벤트명 (A) · 이벤트명 → 코어 emit 상수 (B).
 */
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel: string): string => {
  const abs = join(REPO_ROOT, rel);
  if (!existsSync(abs)) throw new Error(`[트리거 발행자 가드] 파일이 없다: ${rel}`);
  return readFileSync(abs, 'utf8');
};

describe('가드 A — 트리거마다 등록된 발행자', () => {
  it('등록부의 키 집합 = 어휘', () => {
    expect(Object.keys(COUPON_TRIGGER_SOURCES).sort()).toEqual([...AUTO_ISSUE_TRIGGERS].sort());
  });

  for (const trigger of AUTO_ISSUE_TRIGGERS) {
    const source = COUPON_TRIGGER_SOURCES[trigger];

    it(`${trigger} — ${source.kind}`, () => {
      if (source.kind === 'medusa_subscriber') {
        const src = read(source.file);
        expect(src).toMatch(new RegExp(`event:\\s*'${source.event.replace('.', '\\.')}'`));
        expect(src).toContain(`'${trigger}'`);
      } else {
        const producer = read(source.producerFile);
        expect(producer).toMatch(
          new RegExp(`(?:enqueue|publishEvent)\\(\\s*\\{[^}]*eventType:\\s*'${source.eventType}'`, 's'),
        );
        const consumer = read(source.consumerFile);
        expect(consumer).toContain(`case '${source.eventType}'`);
        const issuer = read(source.issuerFile);
        expect(issuer).toContain('issuePromotionsByTrigger(');
        expect(issuer).toContain(`'${trigger}'`);
      }
    });
  }
});
