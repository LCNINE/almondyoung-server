import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { ConflictError, NotFoundError } from '@app/shared';
import { errorDetail, isDomainRefusal, toAddressBlocker } from './channel-change-blockers';

describe('toAddressBlocker', () => {
  it.each([
    ['SHIPMENT_ACTIVE_INVOICE', 'WAYBILL_ISSUED'],
    ['SHIPMENT_ACTIVE_WORK_ITEM', 'SHIPMENT_IN_BATCH'],
    ['SHIPMENT_CUSTODY_EXISTS', 'SHIPMENT_IN_BATCH'],
    ['SHIPMENT_RECIPIENT_INCOMPLETE', 'RECIPIENT_INCOMPLETE'],
    ['SHIPMENT_CONSOLIDATED', 'CONSOLIDATED_SHIPMENT'],
    ['SHIPMENT_REOPEN_REQUIRED', 'SHIPMENT_NOT_REVISABLE'],
  ])('%s → %s', (code, expected) => {
    expect(toAddressBlocker(new ConflictException({ code, message: 'm' }), 'sh-1')).toEqual({
      code: expected,
      shipmentId: 'sh-1',
      detail: 'm',
    });
  });

  it('ApplicationException 은 message 를 detail 로', () => {
    expect(toAddressBlocker(new ConflictError('박스 잠김'), 'sh-1')).toEqual({
      code: 'SHIPMENT_NOT_REVISABLE',
      shipmentId: 'sh-1',
      detail: '박스 잠김',
    });
  });

  it('코드 없는 예외는 SHIPMENT_NOT_REVISABLE', () => {
    expect(toAddressBlocker(new Error('boom'))).toEqual({ code: 'SHIPMENT_NOT_REVISABLE', detail: 'boom' });
  });
});

describe('errorDetail', () => {
  it('Nest 예외의 message 를, 없으면 Error.message 를', () => {
    expect(errorDetail(new BadRequestException('이미 출고'))).toBe('이미 출고');
    expect(errorDetail(new ConflictException({ code: 'X', message: '짧음' }))).toBe('짧음');
    expect(errorDetail('문자열')).toBe('문자열');
    expect(errorDetail(new NotFoundError('라인 없음'))).toBe('라인 없음');
  });
});

describe('isDomainRefusal', () => {
  it('Nest HttpException 계열(점검 모드 503 포함)과 ApplicationException 계열은 도메인 거절', () => {
    expect(isDomainRefusal(new ConflictException({ code: 'X', message: 'm' }))).toBe(true);
    expect(isDomainRefusal(new BadRequestException('m'))).toBe(true);
    expect(isDomainRefusal(new ServiceUnavailableException('maintenance'))).toBe(true);
    expect(isDomainRefusal(new ConflictError('m'))).toBe(true);
    expect(isDomainRefusal(new NotFoundError('m'))).toBe(true);
  });

  it('그 밖(일반 Error·TypeError·Postgres 오류 객체·비 Error)은 거절이 아니다 — 재시도로 넘긴다', () => {
    expect(isDomainRefusal(new Error('boom'))).toBe(false);
    expect(isDomainRefusal(new TypeError('x is undefined'))).toBe(false);
    const pgError = Object.assign(new Error('deadlock detected'), {
      name: 'PostgresError',
      code: '40P01',
      severity: 'ERROR',
    });
    expect(isDomainRefusal(pgError)).toBe(false);
    expect(isDomainRefusal({ code: '55P03', message: 'lock timeout' })).toBe(false);
    expect(isDomainRefusal('문자열')).toBe(false);
  });
});
