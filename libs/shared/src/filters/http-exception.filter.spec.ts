import { ArgumentsHost, ConflictException } from '@nestjs/common';
import { GlobalExceptionFilter } from './http-exception.filter';

describe('domain error response contract', () => {
  it.each([
    'OPERATION_PAYLOAD_MISMATCH',
    'OPERATION_IN_PROGRESS',
    'CLIENT_UPDATE_REQUIRED',
    'SHIPMENT_ALREADY_DISPATCHED',
  ])('preserves %s in both code and error', (code) => {
    let response: unknown;
    const reply = {
      status: () => reply,
      send: (body: unknown) => {
        response = body;
      },
    };
    const host = {
      switchToHttp: () => ({ getResponse: () => reply, getRequest: () => ({ method: 'POST', url: '/inventory' }) }),
    } as ArgumentsHost;
    new GlobalExceptionFilter().catch(new ConflictException({ code, message: '작업을 확인해 주세요.' }), host);
    expect(response).toMatchObject({ error: code, code, message: '작업을 확인해 주세요.' });
  });
});

// 응답 필터를 거친 본문만 돌려주는 가짜 reply/host. details 허용목록 describe 들이 공유한다
function render(code: string, details: unknown) {
  let body: unknown;
  const reply = {
    status: () => reply,
    send: (value: unknown) => {
      body = value;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => reply, getRequest: () => ({ method: 'POST', url: '/' }) }),
  } as ArgumentsHost;
  new GlobalExceptionFilter().catch(new ConflictException({ code, message: 'blocked', details }), host);
  return body;
}

describe('preparation details allowlist', () => {
  it('preserves known preparation action details without arbitrary fields', () => {
    expect(
      render('SIMPLE_OUTBOUND_PLAN_INVALIDATED', {
        reasonCode: 'SOURCE_INSUFFICIENT',
        recovery: 'retry_preparation',
        secret: 'hidden',
      }),
    ).toMatchObject({ details: { reasonCode: 'SOURCE_INSUFFICIENT', recovery: 'retry_preparation' } });
    expect(
      JSON.stringify(
        render('SIMPLE_OUTBOUND_PLAN_INVALIDATED', {
          reasonCode: 'SOURCE_INSUFFICIENT',
          recovery: 'retry_preparation',
          secret: 'hidden',
        }),
      ),
    ).not.toContain('hidden');
  });
  it('keeps BATCH_NOT_STARTED so the app can show the start-from-batch-screen message', () => {
    expect(
      render('SIMPLE_OUTBOUND_PLAN_INVALIDATED', { reasonCode: 'BATCH_NOT_STARTED', recovery: 'retry_preparation' }),
    ).toMatchObject({ details: { reasonCode: 'BATCH_NOT_STARTED', recovery: 'retry_preparation' } });
  });
  it.each([
    ['OTHER', { reasonCode: 'SOURCE_INSUFFICIENT', recovery: 'retry_preparation' }],
    ['SIMPLE_OUTBOUND_PLAN_INVALIDATED', { reasonCode: 'DB_ERROR', recovery: 'retry_preparation' }],
    ['SIMPLE_OUTBOUND_PLAN_INVALIDATED', { reasonCode: 'SOURCE_INSUFFICIENT', recovery: 'unknown' }],
  ])('drops unrecognized %s details', (code, details) => {
    expect(render(String(code), details)).not.toHaveProperty('details');
  });
});

describe('line box details allowlist (#1063)', () => {
  const box = { shipmentId: 's-1', status: 'planned', batchId: 'b-1', hasActiveWaybill: false };

  it('passes the blocking boxes so the screen can link to the batch', () => {
    expect(render('LINE_BOX_NOT_DRAFT', { fulfillmentOrderId: 'fo-1', boxes: [box] })).toMatchObject({
      code: 'LINE_BOX_NOT_DRAFT',
      details: { fulfillmentOrderId: 'fo-1', boxes: [box] },
    });
  });

  it('accepts a null fulfillmentOrderId and drops fields outside the shape', () => {
    const body = render('LINE_BOX_NOT_DRAFT', {
      fulfillmentOrderId: null,
      secret: 'hidden',
      boxes: [{ ...box, batchId: null, secret: 'hidden' }],
    });
    expect(body).toMatchObject({ details: { fulfillmentOrderId: null, boxes: [{ ...box, batchId: null }] } });
    expect(JSON.stringify(body)).not.toContain('hidden');
  });

  it.each([
    ['OTHER', { fulfillmentOrderId: 'fo-1', boxes: [box] }],
    ['LINE_BOX_NOT_DRAFT', { fulfillmentOrderId: 'fo-1' }],
    ['LINE_BOX_NOT_DRAFT', { fulfillmentOrderId: 7, boxes: [box] }],
    ['LINE_BOX_NOT_DRAFT', { fulfillmentOrderId: 'fo-1', boxes: [{ ...box, hasActiveWaybill: 'no' }] }],
    ['LINE_BOX_NOT_DRAFT', { fulfillmentOrderId: 'fo-1', boxes: [null] }],
  ])('drops malformed %s details', (code, details) => {
    expect(render(String(code), details)).not.toHaveProperty('details');
  });
});
