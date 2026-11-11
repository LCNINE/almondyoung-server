import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { CoupangBaseClient } from './coupang-base.client.service';

class TestClient extends CoupangBaseClient {
  call<T>(method: 'GET' | 'PATCH' | 'POST' | 'PUT', path: string, body?: unknown) {
    return this.send<T>(method, path, { body });
  }
}

describe('CoupangBaseClient.send', () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.COUPANG_VENDOR_ID = 'A00000000';
    process.env.COUPANG_ACCESS_KEY = 'ak';
    process.env.COUPANG_SECRET_KEY = 'sk';
    delete process.env.COUPANG_READ_ONLY;
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it('COUPANG_READ_ONLY=true 면 GET 이 아닌 호출은 보내기 전에 막는다', async () => {
    const request = jest.fn();
    const client = new TestClient({ request } as unknown as HttpService);
    process.env.COUPANG_READ_ONLY = 'true';
    await expect(client.call('PATCH', '/x', { a: 1 })).rejects.toThrow('COUPANG_READ_ONLY: PATCH /x 차단');
    expect(request).not.toHaveBeenCalled();
  });

  it('읽기 전용이어도 GET 은 보내고 긴 ID 를 문자열로 돌려준다', async () => {
    const request = jest.fn().mockReturnValue(of({ status: 200, data: '{"data":{"orderId":98765432109876543}}' }));
    const client = new TestClient({ request } as unknown as HttpService);
    process.env.COUPANG_READ_ONLY = 'true';
    await expect(client.call('GET', '/x')).resolves.toEqual({ data: { orderId: '98765432109876543' } });
  });

  it('본문의 긴 ID 문자열을 정수 리터럴로 보낸다', async () => {
    const request = jest.fn().mockReturnValue(of({ status: 200, data: '{}' }));
    const client = new TestClient({ request } as unknown as HttpService);
    await client.call('POST', '/x', { shipmentBoxIds: ['123456789012345678'] });
    expect(request.mock.calls[0][0].data).toBe('{"shipmentBoxIds":[123456789012345678]}');
  });

  it('HTTP 오류는 상태 코드를 메시지와 status 에 싣는다', async () => {
    const request = jest.fn().mockReturnValue(throwError(() => ({ response: { status: 400, data: 'bad' } })));
    const client = new TestClient({ request } as unknown as HttpService);
    await expect(client.call('GET', '/x')).rejects.toMatchObject({ message: '쿠팡 400: bad', status: 400 });
  });

  it('요청마다 30초 timeout 을 건다', async () => {
    const request = jest.fn().mockReturnValue(of({ status: 200, data: '{}' }));
    const client = new TestClient({ request } as unknown as HttpService);
    await client.call('GET', '/x');
    expect(request.mock.calls[0][0].timeout).toBe(30_000);
  });

  it('timeout 은 메서드·경로를 실은 오류로 throw 한다', async () => {
    const request = jest
      .fn()
      .mockReturnValue(
        throwError(() => Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' })),
      );
    const client = new TestClient({ request } as unknown as HttpService);
    await expect(client.call('GET', '/v2/slow')).rejects.toThrow('쿠팡 시간 초과(30000ms): GET /v2/slow');
  });
});
