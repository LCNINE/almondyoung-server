// 매칭 편집 창의 저장 순서(#1016 12번, 스펙 docs/superpowers/specs/2026-10-08-order-reconciler-design.md §5.6).
// core 는 variant 로의 전략 변경을 거절한다 — variant 는 링크와 함께 upsert 로만 만든다(upsert 가 variant 를 직접 쓴다).
// 예전엔 upsert 와 전략 변경을 동시에 보내 void→variant + 링크 추가에서 경합했다. 단계는 순서대로 실행한다.

export type MatchingSaveStep =
  | { kind: 'upsert'; changedLinks: boolean }
  | { kind: 'setStrategy'; strategy: 'void' }
  | { kind: 'setPriority' };

export function planMatchingSave(input: {
  currentStrategy: 'variant' | 'void' | null;
  strategy: 'variant' | 'void';
  linkCount: number;
  changedLinks: boolean;
  changedPolicy: boolean;
  changedPriority: boolean;
}): { ok: true; steps: MatchingSaveStep[] } | { ok: false; message: string } {
  const steps: MatchingSaveStep[] = [];
  const changedStrategy = input.strategy !== input.currentStrategy;

  if (input.strategy === 'void') {
    if (changedStrategy) steps.push({ kind: 'setStrategy', strategy: 'void' });
    // void 는 링크가 없다 — 정책만 저장한다
    if (input.changedPolicy) steps.push({ kind: 'upsert', changedLinks: false });
  } else {
    if (changedStrategy && input.linkCount === 0) {
      return { ok: false, message: '재고상품을 1개 이상 연결해야 합니다.' };
    }
    if (changedStrategy || input.changedLinks || input.changedPolicy) {
      steps.push({ kind: 'upsert', changedLinks: changedStrategy || input.changedLinks });
    }
  }

  if (input.changedPriority) steps.push({ kind: 'setPriority' });
  return { ok: true, steps };
}
