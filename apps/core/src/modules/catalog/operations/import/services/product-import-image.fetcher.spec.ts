import { ProductImportImageFetcher, MAX_REDIRECT_HOPS } from './product-import-image.fetcher';

/** 공개 IP 리터럴 — 가드가 DNS 없이 통과시킨다. 목 fetch 가 실제로 나가지는 않는다. */
const OK_URL = 'https://8.8.8.8/a.jpg';
const PRIVATE_URL = 'https://169.254.169.254/a.jpg';

function response(init: {
  status?: number;
  headers?: Record<string, string>;
  chunks?: Uint8Array[];
}): Response {
  const { status = 200, headers = {}, chunks = [] } = init;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Response(status === 204 || status >= 300 ? null : stream, { status, headers });
}

describe('ProductImportImageFetcher', () => {
  const fetcher = new ProductImportImageFetcher();
  let mock: jest.Mock;

  beforeEach(() => {
    mock = jest.fn();
    global.fetch = mock as unknown as typeof global.fetch;
  });

  describe('probe', () => {
    it('HEAD 200 이면 content-type/length 를 돌려준다', async () => {
      mock.mockResolvedValue(response({ headers: { 'content-type': 'image/jpeg', 'content-length': '12345' } }));
      await expect(fetcher.probe(OK_URL)).resolves.toEqual({ mimeType: 'image/jpeg', sizeBytes: 12345 });
      expect(mock.mock.calls[0][1].method).toBe('HEAD');
    });

    it('헤더가 없으면 null 로 둔다 (fetch 단계가 판정한다)', async () => {
      mock.mockResolvedValue(response({}));
      await expect(fetcher.probe(OK_URL)).resolves.toEqual({ mimeType: null, sizeBytes: null });
    });

    it('HEAD 405 면 Range GET 으로 폴백한다', async () => {
      mock
        .mockResolvedValueOnce(response({ status: 405 }))
        .mockResolvedValueOnce(response({ status: 206, headers: { 'content-type': 'image/png' } }));
      await expect(fetcher.probe(OK_URL)).resolves.toEqual({ mimeType: 'image/png', sizeBytes: null });
      expect(mock.mock.calls[1][1].method).toBe('GET');
      expect(mock.mock.calls[1][1].headers.Range).toBe('bytes=0-0');
    });

    it('4xx/5xx 는 실패다', async () => {
      mock.mockResolvedValue(response({ status: 404 }));
      await expect(fetcher.probe(OK_URL)).rejects.toThrow(/404/);
    });

    it('사설 IP 는 요청을 보내지도 않는다', async () => {
      await expect(fetcher.probe(PRIVATE_URL)).rejects.toThrow(/차단/);
      expect(mock).not.toHaveBeenCalled();
    });

    it('리다이렉트 홉마다 IP 를 다시 검사한다', async () => {
      mock.mockResolvedValueOnce(response({ status: 302, headers: { location: PRIVATE_URL } }));
      await expect(fetcher.probe(OK_URL)).rejects.toThrow(/차단/);
      expect(mock).toHaveBeenCalledTimes(1);
    });

    it('리다이렉트가 상한을 넘으면 실패다', async () => {
      mock.mockResolvedValue(response({ status: 302, headers: { location: 'https://8.8.4.4/next.jpg' } }));
      await expect(fetcher.probe(OK_URL)).rejects.toThrow(/리다이렉트/);
      expect(mock).toHaveBeenCalledTimes(MAX_REDIRECT_HOPS + 1);
    });

    it('Location 없는 3xx 는 실패다', async () => {
      mock.mockResolvedValue(response({ status: 302 }));
      await expect(fetcher.probe(OK_URL)).rejects.toThrow(/Location/);
    });

    it('상대 경로 Location 을 현재 URL 기준으로 해석한다', async () => {
      mock
        .mockResolvedValueOnce(response({ status: 302, headers: { location: '/next.jpg' } }))
        .mockResolvedValueOnce(response({ headers: { 'content-type': 'image/jpeg' } }));
      await expect(fetcher.probe('https://8.8.8.8/a/b.jpg')).resolves.toEqual({
        mimeType: 'image/jpeg',
        sizeBytes: null,
      });
      // 두 번째 홉이 절대 URL 로 만들어졌는지 — 원문 '/next.jpg' 를 그대로 넘기면
      // assertPublicHttpUrl 이 "URL 을 해석할 수 없습니다" 로 던진다.
      expect(mock.mock.calls[1][0]).toBe('https://8.8.8.8/next.jpg');
    });

    it('리다이렉트 홉의 응답 바디를 다음 홉으로 넘어가기 전에 취소한다 (규약을 어기고 3xx 에 바디를 싣는 서버의 소켓 누수 방지)', async () => {
      // 공유 response() 헬퍼는 status>=300 에 body 를 null 로 강제한다 — 이 케이스만
      // 바디 있는 3xx 를 직접 만든다(405/501 폴백 테스트와 같은 이유).
      const redirectBody = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1]));
          controller.close();
        },
      });
      const redirectResponse = new Response(redirectBody, {
        status: 302,
        headers: { location: 'https://8.8.4.4/next.jpg' },
      });
      const cancelSpy = jest.spyOn(redirectResponse.body!, 'cancel');
      mock
        .mockResolvedValueOnce(redirectResponse)
        .mockResolvedValueOnce(response({ headers: { 'content-type': 'image/jpeg' } }));

      await expect(fetcher.probe(OK_URL)).resolves.toEqual({ mimeType: 'image/jpeg', sizeBytes: null });
      expect(cancelSpy).toHaveBeenCalled();
    });

    it.each([405, 501])(
      'HEAD %i 폴백 시 원본 응답 바디를 취소한다 (규약 어기는 서버의 소켓 누수 방지)',
      async (status) => {
        // 공유 response() 헬퍼는 status>=300 에 body 를 null 로 강제한다 — 그건 그 헬퍼의
        // 편의일 뿐 Fetch API 제약이 아니다. 이 케이스만 바디 있는 405/501 을 직접 만든다.
        const headBody = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1]));
            controller.close();
          },
        });
        const headResponse = new Response(headBody, { status });
        const cancelSpy = jest.spyOn(headResponse.body!, 'cancel');
        mock
          .mockResolvedValueOnce(headResponse)
          .mockResolvedValueOnce(response({ status: 206, headers: { 'content-type': 'image/png' } }));

        await expect(fetcher.probe(OK_URL)).resolves.toEqual({ mimeType: 'image/png', sizeBytes: null });
        expect(cancelSpy).toHaveBeenCalled();
      },
    );
  });

  describe('전송 오류', () => {
    it('타임아웃은 한국어 메시지로 바뀐다', async () => {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      mock.mockRejectedValue(err);
      await expect(fetcher.fetch(OK_URL, 1024, 1000)).rejects.toThrow(/제한 시간/);
    });

    it('연결 실패도 한국어 메시지로 바뀐다', async () => {
      mock.mockRejectedValue(new TypeError('fetch failed'));
      await expect(fetcher.probe(OK_URL)).rejects.toThrow(/연결하지 못했습니다/);
    });

    it('가드가 던진 차단 오류는 감싸지 않고 그대로 올린다', async () => {
      await expect(fetcher.probe(PRIVATE_URL)).rejects.toThrow(/차단/);
      expect(mock).not.toHaveBeenCalled();
    });
  });

  describe('fetch', () => {
    it('본문을 Buffer 로 모아 크기와 함께 돌려준다', async () => {
      mock.mockResolvedValue(
        response({ headers: { 'content-type': 'image/webp' }, chunks: [new Uint8Array([1, 2]), new Uint8Array([3])] }),
      );
      const out = await fetcher.fetch(OK_URL, 1024, 1000);
      expect(out.sizeBytes).toBe(3);
      expect([...out.body]).toEqual([1, 2, 3]);
      expect(out.mimeType).toBe('image/webp');
    });

    it('Content-Length 가 상한을 넘으면 받지 않는다', async () => {
      mock.mockResolvedValue(response({ headers: { 'content-length': '99999' } }));
      await expect(fetcher.fetch(OK_URL, 1024, 1000)).rejects.toThrow(/상한/);
    });

    it('헤더가 없어도 누적 바이트가 상한을 넘으면 중단한다', async () => {
      mock.mockResolvedValue(response({ chunks: [new Uint8Array(700), new Uint8Array(700)] }));
      await expect(fetcher.fetch(OK_URL, 1024, 1000)).rejects.toThrow(/상한/);
    });

    it('사설 IP 는 요청을 보내지도 않는다', async () => {
      await expect(fetcher.fetch(PRIVATE_URL, 1024, 1000)).rejects.toThrow(/차단/);
      expect(mock).not.toHaveBeenCalled();
    });
  });
});
