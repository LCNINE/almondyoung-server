import { HttpService } from '@nestjs/axios';
import { AxiosError } from 'axios';
import { of, throwError } from 'rxjs';
import { BusinessLicensesService } from './business-licenses.service';

/**
 * odcloud 5xx 를 재시도로 흡수하는지 확인한다.
 * 이 재시도가 없어서 2026-08 직접입력 신청 18건 중 16건이 under_review 로 쌓였다.
 */
function makeService(post: jest.Mock) {
  return new BusinessLicensesService(
    {} as never,
    { post } as unknown as HttpService,
    { get: () => 'test-key' } as never,
    { publishEvent: jest.fn() } as never,
  );
}

function http5xx(status: number, data?: unknown) {
  return throwError(() => new AxiosError('boom', undefined, undefined, undefined, { status, data } as never));
}

const okStatus = { status_code: 'OK', data: [{ b_no: '1234567890', b_stt: '계속사업자', b_stt_cd: '01' }] };

describe('NTS 호출 재시도', () => {
  it('5xx 뒤 성공하면 결과를 돌려준다', async () => {
    const post = jest
      .fn()
      .mockReturnValueOnce(http5xx(503))
      .mockReturnValueOnce(of({ data: okStatus }));

    const result = await makeService(post).fetchBusinessLicense({ businessNumber: '1234567890' });

    expect(post).toHaveBeenCalledTimes(2);
    expect(result.result).toBe('active');
  });

  it('5xx 가 계속되면 3회까지만 시도하고 lookup_failed 로 끝낸다', async () => {
    const post = jest.fn().mockReturnValue(http5xx(504));

    const result = await makeService(post).fetchBusinessLicense({ businessNumber: '1234567890' });

    expect(post).toHaveBeenCalledTimes(3);
    expect(result.result).toBe('lookup_failed');
  });

  it('4xx 는 재시도하지 않는다', async () => {
    const post = jest.fn().mockReturnValue(http5xx(400));

    const result = await makeService(post).fetchBusinessLicense({ businessNumber: '1234567890' });

    expect(post).toHaveBeenCalledTimes(1);
    expect(result.result).toBe('lookup_failed');
  });
});

describe('진위확인 입력값 보존', () => {
  it('조회가 실패해도 입력값을 남긴다 — 이게 없으면 개업일자가 유실돼 재검증이 불가능하다', async () => {
    const post = jest.fn().mockReturnValue(http5xx(503));

    const result = await makeService(post)['verifyWithNts']('1234567890', '홍길동', '20200101');

    expect(result.status).toBe('lookup_failed');
    expect(result.requested).toEqual({
      businessNumber: '1234567890',
      representativeName: '홍길동',
      startDate: '20200101',
    });
  });
});

describe('조회 실패 건 재검증', () => {
  const okValidate = { status_code: 'OK', data: [{ valid: '01', status: { b_stt_cd: '01' } }] };

  function makeDb(rows: unknown[]) {
    const updates: Record<string, unknown>[] = [];
    const db = {
      select: () => ({ from: () => ({ innerJoin: () => ({ where: () => Promise.resolve(rows) }) }) }),
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: () => Promise.resolve(updates.push(values)),
        }),
      }),
    };
    return { dbService: { db } as never, updates };
  }

  function row(id: string, requested?: Record<string, string>) {
    return { id, userId: `user-${id}`, email: 'a@b.c', username: '홍길동', metadata: { ntsValidate: { requested } } };
  }

  it('입력값 없는 건은 건너뛰고, 여전히 실패하면 두지 않으며, 통과하면 승인하고 이벤트를 쏜다', async () => {
    const post = jest
      .fn()
      .mockReturnValueOnce(http5xx(503))
      .mockReturnValueOnce(http5xx(503))
      .mockReturnValueOnce(http5xx(503))
      .mockReturnValueOnce(of({ data: okValidate }));
    const publishEvent = jest.fn<void, [{ aggregateId: string }]>();
    const { dbService, updates } = makeDb([
      row('no-input'),
      row('still-down', { businessNumber: '1234567890', representativeName: '김', startDate: '20200101' }),
      row('recovered', { businessNumber: '1234567890', representativeName: '박', startDate: '20200101' }),
    ]);

    const service = new BusinessLicensesService(
      dbService,
      { post } as unknown as HttpService,
      { get: () => 'test-key' } as never,
      { publishEvent } as never,
    );
    await service.revalidateFailedLookups();

    expect(updates).toHaveLength(1);
    expect(updates[0].status).toBe('approved');
    expect(publishEvent).toHaveBeenCalledTimes(1);
    expect(publishEvent.mock.calls[0][0].aggregateId).toBe('user-recovered');
  });
});

describe('실패 응답 흔적 보관', () => {
  it('5xx 의 상태코드와 본문을 남긴다 — 라이브 한정 5xx 를 사후에 볼 유일한 재료다', async () => {
    const post = jest.fn().mockReturnValue(http5xx(503, { code: 'SERVICE_UNAVAILABLE' }));

    const result = await makeService(post).fetchBusinessLicense({ businessNumber: '1234567890' });

    expect(result.errorStatus).toBe(503);
    expect(result.errorBody).toBe('{"code":"SERVICE_UNAVAILABLE"}');
  });

  it('본문이 길면 잘라서 담는다', async () => {
    const post = jest.fn().mockReturnValue(http5xx(504, 'x'.repeat(5000)));

    const result = await makeService(post).fetchBusinessLicense({ businessNumber: '1234567890' });

    expect(result.errorBody).toHaveLength(1001);
    expect(result.errorBody?.endsWith('…')).toBe(true);
  });
});
