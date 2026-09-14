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
