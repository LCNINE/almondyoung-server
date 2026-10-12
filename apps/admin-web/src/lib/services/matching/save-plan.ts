// 매칭 편집 창의 저장 순서(#1016 12번, 스펙 docs/superpowers/specs/2026-10-08-order-reconciler-design.md §5.6).
// core 는 variant 로의 전략 변경을 거절한다 — variant 는 링크와 함께 upsert 로만 만든다(upsert 가 variant 를 직접 쓴다).
// 예전엔 upsert 와 전략 변경을 동시에 보내 void→variant + 링크 추가에서 경합했다. 단계는 순서대로 실행한다.

export type MatchingSaveStep =
  | { kind: 'upsert'; changedLinks: boolean }
  | { kind: 'setStrategy'; strategy: 'void' }
  | { kind: 'setPriority' }
  // 매칭이 없는 variant 의 정책만 저장 — upsert 는 정책만 바꾸려다 매칭까지 만들어버린다
  | { kind: 'stockPolicy' };

export function planMatchingSave(input: {
  hasMatching: boolean;
  currentStrategy: 'variant' | 'void' | null;
  strategy: 'variant' | 'void';
  linkCount: number;
  changedLinks: boolean;
  changedPolicy: boolean;
  changedPriority: boolean;
}): { ok: true; steps: MatchingSaveStep[] } | { ok: false; message: string } {
  if (!input.hasMatching) {
    // 바꿀 매칭이 없으니 전략·우선순위는 보낼 곳이 없다. 링크가 붙으면 upsert 가 매칭을 만든다
    if (input.changedLinks)
      return { ok: true, steps: [{ kind: 'upsert', changedLinks: true }] };
    return {
      ok: true,
      steps: input.changedPolicy ? [{ kind: 'stockPolicy' }] : [],
    };
  }

  const steps: MatchingSaveStep[] = [];

  if (input.strategy === 'void') {
    if (input.currentStrategy !== 'void')
      steps.push({ kind: 'setStrategy', strategy: 'void' });
    // void 는 링크가 없다 — 정책만 저장한다
    if (input.changedPolicy)
      steps.push({ kind: 'upsert', changedLinks: false });
  } else {
    // pending(null) 의 variant 는 화면 기본값일 뿐이다 — 링크가 붙어야 variant 가 된다
    const fromVoid = input.currentStrategy === 'void';
    if (fromVoid && input.linkCount === 0) {
      return { ok: false, message: '재고상품을 1개 이상 연결해야 합니다.' };
    }
    if (fromVoid || input.changedLinks || input.changedPolicy) {
      steps.push({
        kind: 'upsert',
        changedLinks: fromVoid || input.changedLinks,
      });
    }
  }

  if (input.changedPriority) steps.push({ kind: 'setPriority' });
  return { ok: true, steps };
}
