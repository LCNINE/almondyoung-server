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
  );
}

function http5xx(status: number) {
  return throwError(() => new AxiosError('boom', undefined, undefined, undefined, { status } as never));
}

const okStatus = { status_code: 'OK', data: [{ b_no: '1234567890', b_stt: '계속사업자', b_stt_cd: '01' }] };

describe('NTS 호출 재시도', () => {
  it('5xx 뒤 성공하면 결과를 돌려준다', async () => {
    const post = jest.fn().mockReturnValueOnce(http5xx(503)).mockReturnValueOnce(of({ data: okStatus }));

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
