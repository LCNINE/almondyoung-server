import { Logger } from '@nestjs/common';
import { verify } from 'jsonwebtoken';
import { FormExportFileClient, BULK_FORM_CONTEXT_ID } from './form-export-file.client';

const SECRET = 'secret';
const FILE_SERVICE_URL = 'http://file-service';

describe('FormExportFileClient', () => {
  const config = {
    get: (k: string) => ({ FILE_SERVICE_URL, AUTH_SECRET: SECRET })[k],
  } as never;

  afterEach(() => jest.restoreAllMocks());

  describe('upload', () => {
    it('올바른 컨텍스트·file 필드명으로 업로드하고 fileId 를 돌려준다', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: '0193cccc-dddd-7eee-8fff-000011112222' }),
      });
      global.fetch = fetchMock as never;

      const client = new FormExportFileClient(config);
      const out = await client.upload({ buffer: Buffer.from('x'), fileName: 'form.xlsx', userId: 'u1' });

      expect(out.fileId).toBe('0193cccc-dddd-7eee-8fff-000011112222');
      // fetchMock 이 jest.fn() 제네릭 없이 선언돼 .mock.calls[0] 이 any 다 — 실제 fetch
      // 호출 시그니처로 좁혀 no-unsafe-* 를 피한다.
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://file-service/files/upload');
      const form = init.body as FormData;
      expect(form.get('contextId')).toBe(BULK_FORM_CONTEXT_ID);

      // 파일 필드명은 반드시 'file' 이어야 한다 — file-service 의 FileInterceptor('file')
      // 이 이 정확한 필드명을 요구하고, 다르면 파일 없음(400)으로 처리된다.
      const filePart = form.get('file');
      expect(filePart).toBeInstanceOf(File);
      if (filePart instanceof File) {
        expect(filePart.name).toBe('form.xlsx');
      }
    });

    it('실패 응답은 상태코드만 메시지에 담고 업스트림 본문은 새지 않는다 — 본문은 로그에만 잘려 남는다', async () => {
      // 실제로 새면 절대 우연히 안 걸리게, 흔한 단어가 아닌 식별 가능한 캐나리를 맨 앞에 둔다.
      // 캐나리 자체(21자)는 200자 truncation 창 안에 들어오므로, 잘린 본문이 새더라도 잡힌다.
      const canary = 'UPSTREAM-LEAK-CANARY-';
      const upstreamJunk = canary + 'E'.repeat(500);
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 413,
        text: () => Promise.resolve(upstreamJunk),
      }) as never;

      const client = new FormExportFileClient(config);
      const promise = client.upload({ buffer: Buffer.from('x'), fileName: 'form.xlsx', userId: 'u1' });

      await expect(promise).rejects.toThrow(/413/);
      // 캐나리는 예외 메시지에 절대 없어야 한다 — 있으면 상위 응답(잘렸든 아니든)이 그대로 샌 것.
      await expect(promise).rejects.not.toThrow(new RegExp(canary));
      await expect(promise).rejects.toThrow('file-service 업로드 실패 (413)');

      // 잘린 본문은 로그에만 남는다(200자 truncation 자체는 여기서 확인).
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(upstreamJunk.slice(0, 200)));
      const loggedMessage = warnSpy.mock.calls[0][0] as string;
      expect(loggedMessage.length).toBeLessThan(upstreamJunk.length);
    });
  });

  describe('getDownloadUrl', () => {
    const FILE_ID = '0193cccc-dddd-7eee-8fff-000011112222';

    it('올바른 라우트로 요청해 signedUrl 을 돌려주고, 토큰에 sub/userId/scopes 를 싣는다', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ signedUrl: 'https://signed.example/form.xlsx?sig=abc' }),
      });
      global.fetch = fetchMock as never;

      const client = new FormExportFileClient(config);
      const url = await client.getDownloadUrl(FILE_ID, 'u1');

      expect(url).toBe('https://signed.example/form.xlsx?sig=abc');

      const [reqUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      // 실제 file-service 라우트는 `/files/:fileId/download` 다 — `/download-url` 이 아니다.
      // `download=true` 가 없으면 download.service.ts 가 Content-Disposition 을 안 실어
      // 브라우저가 UUID 파일명으로 저장한다(form-export-file.client.ts:70-76) — 회귀 방지.
      expect(reqUrl).toBe(`http://file-service/files/${FILE_ID}/download?download=true`);

      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toMatch(/^Bearer .+/);
      const payload = verify(headers.Authorization.replace('Bearer ', ''), SECRET) as Record<string, unknown>;
      expect(payload.sub).toBe('core-bulk-session');
      expect(payload.userId).toBe('u1');
      expect(payload.scopes).toEqual(['master']);
    });

    it('실패 응답이면 상태코드를 담아 던진다', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('not found'),
      }) as never;

      const client = new FormExportFileClient(config);
      await expect(client.getDownloadUrl(FILE_ID, 'u1')).rejects.toThrow(/404/);
    });
  });

  describe('download', () => {
    const FILE_ID = '0193cccc-dddd-7eee-8fff-000011112222';

    /**
     * getDownloadUrl(서명 URL 발급) → 실제 GET, 두 단계라 URL 로 갈라 응답을 다르게 준다.
     * 실제 fetch 시그니처로 좁히기 위해 (url: string, init?: RequestInit) 로 받는다.
     */
    function twoStepFetchMock(secondStep: (init: RequestInit | undefined) => Promise<unknown>) {
      return jest.fn((url: string, init?: RequestInit) => {
        if (url.includes('/download?download=true')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ signedUrl: 'https://s3.example/form.xlsx?sig=abc' }),
          });
        }
        return secondStep(init);
      });
    }

    it('서명 URL 을 받아 실제로 GET 하고 바이트를 돌려주며, 타임아웃 signal 을 싣는다', async () => {
      const fileBytes = Buffer.from('workbook-bytes', 'utf8');
      const fetchMock = twoStepFetchMock((init) => {
        // 멈춘 S3 연결이 검증 워커 슬라이스를 무한정 붙잡지 않도록 타임아웃 signal 이
        // 실제 GET 에 실려 있어야 한다 — form-export-file.client.ts DOWNLOAD_TIMEOUT_MS 참조.
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        return Promise.resolve({
          ok: true,
          arrayBuffer: () => Promise.resolve(new Uint8Array(fileBytes).buffer),
        });
      });
      global.fetch = fetchMock as never;

      const client = new FormExportFileClient(config);
      const out = await client.download(FILE_ID, 'u1');

      expect(out.equals(fileBytes)).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('S3 GET 이 실패 응답이면 상태코드를 담아 던지고, 본문은 로그에만 잘려 남는다 (상류 응답이 새지 않는다)', async () => {
      const canary = 'S3-LEAK-CANARY-';
      const upstreamJunk = canary + 'F'.repeat(500);
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const fetchMock = twoStepFetchMock(() =>
        Promise.resolve({ ok: false, status: 403, text: () => Promise.resolve(upstreamJunk) }),
      );
      global.fetch = fetchMock as never;

      const client = new FormExportFileClient(config);
      const promise = client.download(FILE_ID, 'u1');

      await expect(promise).rejects.toThrow('업로드 파일 다운로드 실패 (403)');
      // 캐나리는 예외 메시지에 절대 없어야 한다 — file-service 실패 경로(upload 테스트)와
      // 같은 회귀 방지.
      await expect(promise).rejects.not.toThrow(new RegExp(canary));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(upstreamJunk.slice(0, 200)));
    });
  });

  describe('getMetadata', () => {
    it('메타데이터를 core 가 쓰는 네 필드로 좁혀 돌려준다', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: 'f1',
            contextId: 'product-image',
            status: 'active',
            originalName: 'front.jpg',
            size: 10,
            mimeType: 'image/jpeg',
          }),
      });
      global.fetch = fetchMock as never;

      const client = new FormExportFileClient(config);
      await expect(client.getMetadata('f1', 'u1')).resolves.toEqual({
        id: 'f1',
        contextId: 'product-image',
        status: 'active',
        originalName: 'front.jpg',
      });

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://file-service/files/f1/metadata');
      const auth = (init.headers as Record<string, string>).Authorization;
      // 위임 토큰에 요청자 userId 가 실려야 file-service 접근 검사를 통과한다(upload 와 같은 근거).
      expect(verify(auth.replace('Bearer ', ''), SECRET)).toMatchObject({ userId: 'u1' });
    });

    // 보안 회귀 방지 — 이미지 경로 토큰에 master 가 실리면 file-service 의
    // `isMasterOrOwner`(file-access.ts:62)가 소유권 검사를 단락해, 작업자가 통보한
    // **임의의 fileId** 를 core 가 master 권한으로 읽고 지우는 프리미티브가 된다.
    it('이미지 경로 토큰에는 master 스코프가 없다 — file-service 가 업로더 소유권을 강제해야 한다', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 'f1', contextId: 'product-image', status: 'active', originalName: 'a.jpg' }),
      });
      global.fetch = fetchMock as never;

      const client = new FormExportFileClient(config);
      await client.getMetadata('f1', 'u1');

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const auth = (init.headers as Record<string, string>).Authorization;
      const payload = verify(auth.replace('Bearer ', ''), SECRET) as Record<string, unknown>;
      // owner 분기(file-access.ts:55)가 읽는 클레임은 userId 다 — 이게 없으면 이미지
      // 경로 전체가 403 으로 죽는다.
      expect(payload.userId).toBe('u1');
      expect(payload.scopes).toEqual([]);
      expect(payload.scopes).not.toContain('master');
      // roles 로도 master 가 새면 안 된다(file-access.ts:58 이 roles 도 본다).
      expect(payload.roles).toBeUndefined();
    });

    // 이 분기가 "통보된 fileId 가 실재하는가"의 답이다 — 예외로 만들면 배치 한 건의
    // 오타가 나머지 49건을 통째로 죽인다.
    it('404 는 예외가 아니라 null 이다', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('not found'),
      }) as never;

      const client = new FormExportFileClient(config);
      await expect(client.getMetadata('f1', 'u1')).resolves.toBeNull();
    });

    it('그 밖의 실패는 상태코드를 담아 던진다', async () => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('boom'),
      }) as never;

      const client = new FormExportFileClient(config);
      await expect(client.getMetadata('f1', 'u1')).rejects.toThrow('(500)');
    });

    it('응답 형태가 다르면 던진다 — 조용히 통과시키면 검증이 무력화된다', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 'f1' }),
      }) as never;

      const client = new FormExportFileClient(config);
      await expect(client.getMetadata('f1', 'u1')).rejects.toThrow('형태');
    });
  });

  /**
   * 두 삭제 메서드는 라우트가 같고 **토큰만 다르다**. 그 차이가 이 브랜치의 보안 경계
   * 자체이므로 각각 못 박는다 — 한쪽이 다른 쪽으로 통일되면 (a) 워크북 정리가 403 으로
   * 죽거나 (b) 임의 파일 삭제 취약점이 되살아난다.
   */
  describe('삭제 — 워크북과 이미지의 토큰 분리', () => {
    const FILE_ID = '0193cccc-dddd-7eee-8fff-000011112222';

    function deleteFetchMock() {
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('') });
      global.fetch = fetchMock as never;
      return fetchMock;
    }

    function tokenOf(fetchMock: jest.Mock): Record<string, unknown> {
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const auth = (init.headers as Record<string, string>).Authorization;
      return verify(auth.replace('Bearer ', ''), SECRET) as Record<string, unknown>;
    }

    // 워크북은 만든 사람과 쓰는 사람이 다른 것이 정상이고(assertExportUsable), 만료 정리는
    // 잡 소유자와 다른 맥락(크론)에서 돈다 — owner 검사를 통과할 수 없으므로 master 가 필요하다.
    it('softDelete(워크북)는 master 스코프를 유지한다', async () => {
      const fetchMock = deleteFetchMock();
      await new FormExportFileClient(config).softDelete(FILE_ID, 'u1');

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`http://file-service/files/${FILE_ID}`);
      expect(init.method).toBe('DELETE');
      expect(tokenOf(fetchMock)).toMatchObject({ userId: 'u1', scopes: ['master'] });
    });

    it('softDeleteOwnedFile(이미지)는 master 스코프를 싣지 않는다 — 임의 파일 삭제 방지', async () => {
      const fetchMock = deleteFetchMock();
      await new FormExportFileClient(config).softDeleteOwnedFile(FILE_ID, 'u1');

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`http://file-service/files/${FILE_ID}`);
      expect(init.method).toBe('DELETE');
      const payload = tokenOf(fetchMock);
      expect(payload.userId).toBe('u1');
      expect(payload.scopes).toEqual([]);
      expect(payload.roles).toBeUndefined();
    });

    // 404 = 이미 지워졌다 — 정리는 멱등해야 하므로 성공과 동등 취급한다(두 경로 공통).
    it('두 경로 모두 404 를 성공으로 취급하고, 403 은 던진다', async () => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const client = new FormExportFileClient(config);

      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404, text: () => Promise.resolve('') }) as never;
      await expect(client.softDelete(FILE_ID, 'u1')).resolves.toBeUndefined();
      await expect(client.softDeleteOwnedFile(FILE_ID, 'u1')).resolves.toBeUndefined();

      // 남의 파일을 지우려 하면 file-service 가 403 을 준다 — 호출부가 best-effort 로
      // 흡수하도록 여기서는 던지는 것이 맞다.
      global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: false, status: 403, text: () => Promise.resolve('forbidden') }) as never;
      await expect(client.softDeleteOwnedFile(FILE_ID, 'u1')).rejects.toThrow('(403)');
    });
  });
});
