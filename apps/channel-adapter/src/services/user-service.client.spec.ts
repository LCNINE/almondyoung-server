import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { UserServiceClient } from './user-service.client';

describe('UserServiceClient', () => {
  const get = jest.fn();
  const config = (key: string) =>
    new ConfigService({ USER_SERVICE_URL: 'http://user-service', USER_SERVICE_INTERNAL_KEY: key });

  beforeEach(() => {
    get.mockReset();
  });

  it('두 내부 조회에 인증 헤더를 보낸다', async () => {
    const linkInfo = { userId: 'user-1', email: 'user@example.com' };
    const links = [{ ...linkInfo, cafe24MemberId: 'member-1' }];
    get.mockReturnValueOnce(of({ data: { success: true, data: linkInfo } }));
    get.mockReturnValueOnce(of({ data: { success: true, data: links } }));

    const client = new UserServiceClient({ get } as unknown as HttpService, config('test-key'));

    await expect(client.getLinkInfo('member /+&')).resolves.toEqual(linkInfo);
    await expect(client.getAllLinks()).resolves.toEqual(links);

    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenNthCalledWith(
      1,
      'http://user-service/cafe24/internal/link-info?mallId=lcnine&cafe24MemberId=member%20%2F%2B%26',
      { headers: { Authorization: 'Bearer test-key' } },
    );
    expect(get).toHaveBeenNthCalledWith(2, 'http://user-service/cafe24/internal/links?mallId=lcnine', {
      headers: { Authorization: 'Bearer test-key' },
    });
  });

  it('키가 없으면 요청하지 않는다', async () => {
    const client = new UserServiceClient({ get } as unknown as HttpService, config(''));

    await expect(client.getLinkInfo('member-1')).rejects.toThrow('USER_SERVICE_INTERNAL_KEY');
    await expect(client.getAllLinks()).rejects.toThrow('USER_SERVICE_INTERNAL_KEY');
    expect(get).not.toHaveBeenCalled();
  });

  it('연동 단건 조회의 404만 null로 처리한다', async () => {
    get.mockReturnValue(throwError(() => ({ response: { status: 404 } })));

    const client = new UserServiceClient({ get } as unknown as HttpService, config('test-key'));

    await expect(client.getLinkInfo('member-1')).resolves.toBeNull();
    await expect(client.getAllLinks()).rejects.toMatchObject({ response: { status: 404 } });
  });

  it.each([401, 500])('두 조회의 %s 오류를 호출자에게 전달한다', async (status) => {
    const error = { response: { status } };
    get.mockReturnValue(throwError(() => error));

    const client = new UserServiceClient({ get } as unknown as HttpService, config('test-key'));

    await expect(client.getLinkInfo('member-1')).rejects.toBe(error);
    await expect(client.getAllLinks()).rejects.toBe(error);
  });
});
