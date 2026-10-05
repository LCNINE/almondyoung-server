import { BadRequestException, ConflictException } from '@nestjs/common';
import { errorDetail, toAddressBlocker } from './channel-change-blockers';

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

  it('코드 없는 예외는 SHIPMENT_NOT_REVISABLE', () => {
    expect(toAddressBlocker(new Error('boom'))).toEqual({ code: 'SHIPMENT_NOT_REVISABLE', detail: 'boom' });
  });
});

describe('errorDetail', () => {
  it('Nest 예외의 message 를, 없으면 Error.message 를', () => {
    expect(errorDetail(new BadRequestException('이미 출고'))).toBe('이미 출고');
    expect(errorDetail(new ConflictException({ code: 'X', message: '짧음' }))).toBe('짧음');
    expect(errorDetail('문자열')).toBe('문자열');
  });
});
