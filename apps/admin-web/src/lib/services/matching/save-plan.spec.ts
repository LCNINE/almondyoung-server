import { planMatchingSave } from './save-plan';

const none = { changedLinks: false, changedPolicy: false, changedPriority: false };

describe('planMatchingSave (#1016 12번)', () => {
  it('바뀐 게 없으면 단계 0', () => {
    expect(planMatchingSave({ currentStrategy: 'variant', strategy: 'variant', linkCount: 1, ...none })).toEqual({
      ok: true,
      steps: [],
    });
  });

  it('void → variant 는 upsert 하나 — 전략 변경 요청을 보내지 않는다', () => {
    expect(
      planMatchingSave({ currentStrategy: 'void', strategy: 'variant', linkCount: 2, ...none, changedLinks: true }),
    ).toEqual({ ok: true, steps: [{ kind: 'upsert', changedLinks: true }] });
  });

  it('void → variant 인데 링크가 없으면 막는다', () => {
    expect(planMatchingSave({ currentStrategy: 'void', strategy: 'variant', linkCount: 0, ...none })).toEqual({
      ok: false,
      message: '재고상품을 1개 이상 연결해야 합니다.',
    });
  });

  it('pending 매칭에 링크를 붙이면 upsert 하나', () => {
    expect(
      planMatchingSave({ currentStrategy: null, strategy: 'variant', linkCount: 1, ...none, changedLinks: true }),
    ).toEqual({ ok: true, steps: [{ kind: 'upsert', changedLinks: true }] });
  });

  it('variant → void 는 전략 변경 먼저, 정책은 그다음(링크 없이), 우선순위는 마지막', () => {
    expect(
      planMatchingSave({
        currentStrategy: 'variant',
        strategy: 'void',
        linkCount: 1,
        changedLinks: true,
        changedPolicy: true,
        changedPriority: true,
      }),
    ).toEqual({
      ok: true,
      steps: [{ kind: 'setStrategy', strategy: 'void' }, { kind: 'upsert', changedLinks: false }, { kind: 'setPriority' }],
    });
  });

  it('variant 유지 + 링크·정책 변경은 upsert 하나, 링크를 다 지운 저장도 그대로 보낸다(서버가 pending 으로 내린다)', () => {
    expect(
      planMatchingSave({ currentStrategy: 'variant', strategy: 'variant', linkCount: 0, ...none, changedLinks: true }),
    ).toEqual({ ok: true, steps: [{ kind: 'upsert', changedLinks: true }] });
  });

  it('void 유지 + 정책만 바뀌면 링크 없는 upsert', () => {
    expect(
      planMatchingSave({ currentStrategy: 'void', strategy: 'void', linkCount: 0, ...none, changedPolicy: true }),
    ).toEqual({ ok: true, steps: [{ kind: 'upsert', changedLinks: false }] });
  });
});
