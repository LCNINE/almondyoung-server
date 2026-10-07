import { planMatchingSave } from './save-plan';

const none = {
  hasMatching: true,
  changedLinks: false,
  changedPolicy: false,
  changedPriority: false,
};

describe('planMatchingSave (#1016 12번)', () => {
  it('바뀐 게 없으면 단계 0', () => {
    expect(
      planMatchingSave({
        currentStrategy: 'variant',
        strategy: 'variant',
        linkCount: 1,
        ...none,
      })
    ).toEqual({
      ok: true,
      steps: [],
    });
  });

  it('void → variant 는 upsert 하나 — 전략 변경 요청을 보내지 않는다', () => {
    expect(
      planMatchingSave({
        currentStrategy: 'void',
        strategy: 'variant',
        linkCount: 2,
        ...none,
        changedLinks: true,
      })
    ).toEqual({ ok: true, steps: [{ kind: 'upsert', changedLinks: true }] });
  });

  it('void → variant 인데 링크가 없으면 막는다', () => {
    expect(
      planMatchingSave({
        currentStrategy: 'void',
        strategy: 'variant',
        linkCount: 0,
        ...none,
      })
    ).toEqual({
      ok: false,
      message: '재고상품을 1개 이상 연결해야 합니다.',
    });
  });

  it('pending 매칭에 링크를 붙이면 upsert 하나', () => {
    expect(
      planMatchingSave({
        currentStrategy: null,
        strategy: 'variant',
        linkCount: 1,
        ...none,
        changedLinks: true,
      })
    ).toEqual({ ok: true, steps: [{ kind: 'upsert', changedLinks: true }] });
  });

  it('variant → void 는 전략 변경 먼저, 정책은 그다음(링크 없이), 우선순위는 마지막', () => {
    expect(
      planMatchingSave({
        hasMatching: true,
        currentStrategy: 'variant',
        strategy: 'void',
        linkCount: 1,
        changedLinks: true,
        changedPolicy: true,
        changedPriority: true,
      })
    ).toEqual({
      ok: true,
      steps: [
        { kind: 'setStrategy', strategy: 'void' },
        { kind: 'upsert', changedLinks: false },
        { kind: 'setPriority' },
      ],
    });
  });

  it('variant 유지 + 링크·정책 변경은 upsert 하나, 링크를 다 지운 저장도 그대로 보낸다(서버가 pending 으로 내린다)', () => {
    expect(
      planMatchingSave({
        currentStrategy: 'variant',
        strategy: 'variant',
        linkCount: 0,
        ...none,
        changedLinks: true,
      })
    ).toEqual({ ok: true, steps: [{ kind: 'upsert', changedLinks: true }] });
  });

  it('void 유지 + 정책만 바뀌면 링크 없는 upsert', () => {
    expect(
      planMatchingSave({
        currentStrategy: 'void',
        strategy: 'void',
        linkCount: 0,
        ...none,
        changedPolicy: true,
      })
    ).toEqual({ ok: true, steps: [{ kind: 'upsert', changedLinks: false }] });
  });

  it('pending 매칭은 화면 기본값 variant 만으로는 전략 변경이 아니다 — 정책만 바꾸면 링크 없는 upsert', () => {
    expect(
      planMatchingSave({
        currentStrategy: null,
        strategy: 'variant',
        linkCount: 0,
        ...none,
        changedPolicy: true,
      })
    ).toEqual({ ok: true, steps: [{ kind: 'upsert', changedLinks: false }] });
    expect(
      planMatchingSave({
        currentStrategy: null,
        strategy: 'variant',
        linkCount: 0,
        ...none,
      })
    ).toEqual({
      ok: true,
      steps: [],
    });
  });

  describe('매칭이 아직 없는 variant', () => {
    const noMatching = { ...none, hasMatching: false, currentStrategy: null };

    it('링크를 붙이면 upsert 하나 — upsert 가 매칭을 만든다', () => {
      expect(
        planMatchingSave({
          ...noMatching,
          strategy: 'variant',
          linkCount: 1,
          changedLinks: true,
          changedPolicy: true,
        })
      ).toEqual({ ok: true, steps: [{ kind: 'upsert', changedLinks: true }] });
    });

    it('정책만 바뀌면 variant 재고 정책 경로 — upsert 는 매칭까지 만들어버린다', () => {
      expect(
        planMatchingSave({
          ...noMatching,
          strategy: 'variant',
          linkCount: 0,
          changedPolicy: true,
        })
      ).toEqual({
        ok: true,
        steps: [{ kind: 'stockPolicy' }],
      });
    });

    it('바꿀 매칭이 없으니 전략·우선순위 변경은 보내지 않는다', () => {
      expect(
        planMatchingSave({
          ...noMatching,
          strategy: 'void',
          linkCount: 0,
          changedPriority: true,
          changedPolicy: true,
        })
      ).toEqual({ ok: true, steps: [{ kind: 'stockPolicy' }] });
    });
  });
});
