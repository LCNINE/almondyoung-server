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

describe('preparation details allowlist', () => {
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
    new GlobalExceptionFilter().catch(new ConflictException({ code, details }), host);
    return body;
  }
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
  it.each([
    ['OTHER', { reasonCode: 'SOURCE_INSUFFICIENT', recovery: 'retry_preparation' }],
    ['SIMPLE_OUTBOUND_PLAN_INVALIDATED', { reasonCode: 'DB_ERROR', recovery: 'retry_preparation' }],
    ['SIMPLE_OUTBOUND_PLAN_INVALIDATED', { reasonCode: 'SOURCE_INSUFFICIENT', recovery: 'unknown' }],
  ])('drops unrecognized %s details', (code, details) => {
    expect(render(String(code), details)).not.toHaveProperty('details');
  });
});
