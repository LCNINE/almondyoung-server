import { of } from 'rxjs';
import { UserContactClient } from './user-contact.client';

// user-service 응답은 ResponseInterceptor 가 { success, data } 로 감싼다.
// 이 언랩이 빠져 크론이 매일 "data is not iterable" 로 죽었었다.
function makeClient(response: unknown) {
  const httpService = { post: jest.fn().mockReturnValue(of({ data: response })) } as any;
  const configService = {
    get: (k: string) => (k === 'USER_SERVICE_URL' ? 'http://user' : 'secret'),
  } as any;
  return { client: new UserContactClient(httpService, configService), httpService };
}

describe('UserContactClient', () => {
  it('envelope 안의 배열을 userId 로 맵핑한다', async () => {
    const { client } = makeClient({
      success: true,
      data: [{ userId: 'u1', email: 'a@b.com', username: '홍길동' }],
    });

    const result = await client.findContacts(['u1']);

    expect(result.get('u1')?.email).toBe('a@b.com');
  });

  it('대상이 없으면 호출하지 않는다', async () => {
    const { client, httpService } = makeClient({ success: true, data: [] });

    expect((await client.findContacts([])).size).toBe(0);
    expect(httpService.post).not.toHaveBeenCalled();
  });
});
