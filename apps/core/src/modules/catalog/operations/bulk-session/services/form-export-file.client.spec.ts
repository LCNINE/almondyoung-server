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
});
