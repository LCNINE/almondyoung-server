import { PauseService } from './pause.service';

/**
 * 자동 재개 크론이 «선점에 성공한 실행만» 발행하는지를 고정한다 (#707).
 *
 * 배포 창에서 태스크가 겹치면(`minHealthy=100` + `maxPercent=200`) 두 인스턴스가 같은
 * 「재개 대상」 목록을 읽는다. 조건부 UPDATE 가 한 쪽만 통과시키므로, 진 쪽이 그래도 발행하면
 * DB 는 멀쩡한 채 재개 알림만 두 번 나간다 — 로그로는 정상으로 보이는 종류의 사고다.
 */
function makeService(due: { userId: string; id: string }[]) {
  const pauseReader = {
    findEntitlementsDueForAutoResume: jest.fn().mockResolvedValue(due),
    findPausedEntitlement: jest.fn(),
  } as never as ConstructorParameters<typeof PauseService>[0];

  const resumePause = jest.fn();
  const pauseManager = { resumePause } as never as ConstructorParameters<typeof PauseService>[1];

  const published: { userId: string; status: string }[] = [];
  const publishStatusChanged = jest.fn((payload: { userId: string; status: string }) => {
    published.push(payload);
    return Promise.resolve();
  });
  const publisher = { publishStatusChanged } as never as ConstructorParameters<typeof PauseService>[2];

  return {
    service: new PauseService(pauseReader, pauseManager, publisher),
    resumePause,
    publishStatusChanged,
    published,
  };
}

const ENTITLEMENT = { userId: 'u-1', id: 'e-1' };

describe('PauseService.autoResumeExpiredPauses — 자동 재개', () => {
  it('재개에 성공하면 RESUMED 를 발행한다', async () => {
    const { service, resumePause, published } = makeService([ENTITLEMENT]);
    resumePause.mockResolvedValue({ resumeEventId: 'r-1', endsAt: '2026-10-01' });

    await service.autoResumeExpiredPauses();

    expect(published).toEqual([expect.objectContaining({ userId: 'u-1', status: 'RESUMED' })]);
  });

  it('선점에 지면(null) 발행하지 않는다 — 알림이 두 번 나가지 않는다', async () => {
    const { service, resumePause, publishStatusChanged } = makeService([ENTITLEMENT]);
    resumePause.mockResolvedValue(null);

    await service.autoResumeExpiredPauses();

    expect(resumePause).toHaveBeenCalledTimes(1);
    expect(publishStatusChanged).not.toHaveBeenCalled();
  });

  it('한 건이 선점에 져도 나머지는 계속 처리한다', async () => {
    const { service, resumePause, published } = makeService([ENTITLEMENT, { userId: 'u-2', id: 'e-2' }]);
    resumePause.mockResolvedValueOnce(null).mockResolvedValueOnce({ resumeEventId: 'r-2', endsAt: '2026-10-02' });

    await service.autoResumeExpiredPauses();

    expect(published).toEqual([expect.objectContaining({ userId: 'u-2' })]);
  });

  it('대상이 없으면 매니저를 부르지 않는다', async () => {
    const { service, resumePause } = makeService([]);

    await service.autoResumeExpiredPauses();

    expect(resumePause).not.toHaveBeenCalled();
  });
});
