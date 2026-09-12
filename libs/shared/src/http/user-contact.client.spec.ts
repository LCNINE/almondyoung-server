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

  // HttpModule 은 어느 앱에서도 설정 없이 등록돼 있어 axios 기본값(=무제한)이 그대로 걸린다.
  // wallet 은 이 조회를 선적용 가입의 agreement 생성 «요청 안에서» 부르므로, 상한이 없으면
  // user-service 가 응답을 안 할 때 가입이 선 채로 멈추고 membership 의 재시도·void 도 멈춘다.
  it('청크마다 상한을 건다 — 늦는 것도 실패로 끊는다', async () => {
    const { client, httpService } = makeClient({
      success: true,
      data: [{ userId: 'u1', email: 'a@b.com', username: '홍길동' }],
    });

    await client.findContacts(['u1']);

    const [, , config] = httpService.post.mock.calls[0];
    expect(config.timeout).toBeGreaterThan(0);
  });

  it('대상이 없으면 호출하지 않는다', async () => {
    const { client, httpService } = makeClient({ success: true, data: [] });

    expect((await client.findContacts([])).size).toBe(0);
    expect(httpService.post).not.toHaveBeenCalled();
  });
});
