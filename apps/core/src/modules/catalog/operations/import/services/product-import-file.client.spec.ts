import { ConfigService } from '@nestjs/config';
import { verify } from 'jsonwebtoken';
import { ProductImportFileClient, IMAGE_CONTEXT_BY_USAGE, MAX_ERROR_BODY_CHARS } from './product-import-file.client';

const SECRET = 'test-auth-secret';
const USER_ID = '0193aaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function config(overrides: Record<string, string | undefined> = {}): ConfigService {
  const values: Record<string, string | undefined> = {
    AUTH_SECRET: SECRET,
    FILE_SERVICE_URL: 'https://file.example/',
    ...overrides,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe('ProductImportFileClient', () => {
  let mock: jest.Mock;

  beforeEach(() => {
    mock = jest.fn();
    global.fetch = mock as unknown as typeof global.fetch;
  });

  it('multipart 로 올리고 fileId 를 돌려준다', async () => {
    mock.mockResolvedValue(new Response(JSON.stringify({ id: 'file-1' }), { status: 200 }));
    const client = new ProductImportFileClient(config());

    const out = await client.upload({
      body: Buffer.from([1, 2, 3]),
      fileName: 'IMG-1.jpg',
      mimeType: 'image/jpeg',
      usage: 'main',
      userId: USER_ID,
    });

    expect(out).toEqual({ fileId: 'file-1' });
    const [url, init] = mock.mock.calls[0];
    // baseUrl 의 트레일링 슬래시는 잘려야 한다
    expect(url).toBe('https://file.example/files/upload');
    expect(init.method).toBe('POST');
    const form = init.body as FormData;
    expect(form.get('contextId')).toBe(IMAGE_CONTEXT_BY_USAGE.main);
    expect(form.get('isPublic')).toBe('true');
  });

  it('토큰에 sub 와 userId 를 함께 싣는다 (uploads.uploaded_by 가 NOT NULL uuid)', async () => {
    mock.mockResolvedValue(new Response(JSON.stringify({ id: 'file-1' }), { status: 200 }));
    const client = new ProductImportFileClient(config());

    await client.upload({
      body: Buffer.from([1]),
      fileName: 'a.jpg',
      mimeType: 'image/jpeg',
      usage: 'description',
      userId: USER_ID,
    });

    const auth = (mock.mock.calls[0][1].headers as Record<string, string>).Authorization;
    const payload = verify(auth.replace('Bearer ', ''), SECRET) as Record<string, unknown>;
    expect(payload.userId).toBe(USER_ID);
    expect(payload.sub).toBeTruthy();
    expect(payload.scopes).toEqual(['master']);
    expect((mock.mock.calls[0][1].body as FormData).get('contextId')).toBe(
      IMAGE_CONTEXT_BY_USAGE.description,
    );
  });

  it('userId 가 비면 업로드 자체를 하지 않는다', async () => {
    const client = new ProductImportFileClient(config());
    await expect(
      client.upload({ body: Buffer.from([1]), fileName: 'a.jpg', mimeType: 'image/jpeg', usage: 'main', userId: '' }),
    ).rejects.toThrow(/업로더/);
    expect(mock).not.toHaveBeenCalled();
  });

  it('file-service 가 실패하면 상태코드와 본문을 담아 던진다', async () => {
    mock.mockResolvedValue(new Response('nope', { status: 400, statusText: 'Bad Request' }));
    const client = new ProductImportFileClient(config());
    await expect(
      client.upload({
        body: Buffer.from([1]),
        fileName: 'a.jpg',
        mimeType: 'image/jpeg',
        usage: 'main',
        userId: USER_ID,
      }),
    ).rejects.toThrow(/400.*nope/s);
  });

  it('AUTH_SECRET 이 없으면 던진다', async () => {
    const client = new ProductImportFileClient(config({ AUTH_SECRET: undefined }));
    await expect(
      client.upload({
        body: Buffer.from([1]),
        fileName: 'a.jpg',
        mimeType: 'image/jpeg',
        usage: 'main',
        userId: USER_ID,
      }),
    ).rejects.toThrow(/AUTH_SECRET/);
  });

  it('softDelete 는 DELETE /files/:id 를 부른다', async () => {
    mock.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    const client = new ProductImportFileClient(config());
    await client.softDelete('file-1', USER_ID);
    expect(mock.mock.calls[0][0]).toBe('https://file.example/files/file-1');
    expect(mock.mock.calls[0][1].method).toBe('DELETE');
  });

  it('softDelete 는 404 를 성공으로 본다 (이미 지워진 것)', async () => {
    mock.mockResolvedValue(new Response('not found', { status: 404 }));
    const client = new ProductImportFileClient(config());
    await expect(client.softDelete('file-1', USER_ID)).resolves.toBeUndefined();
  });

  it('softDelete 는 404 가 아닌 실패를 상태코드와 본문을 담아 던진다', async () => {
    mock.mockResolvedValue(new Response('boom', { status: 500, statusText: 'Internal Server Error' }));
    const client = new ProductImportFileClient(config());
    await expect(client.softDelete('file-1', USER_ID)).rejects.toThrow(/500.*boom/s);
  });

  it('softDelete 도 userId 가 비면 요청을 보내지 않는다', async () => {
    const client = new ProductImportFileClient(config());
    await expect(client.softDelete('file-1', '')).rejects.toThrow(/업로더/);
    expect(mock).not.toHaveBeenCalled();
  });

  it('FILE_SERVICE_URL 이 없으면 요청 전에 던진다', async () => {
    const client = new ProductImportFileClient(config({ FILE_SERVICE_URL: undefined }));
    await expect(
      client.upload({
        body: Buffer.from([1]),
        fileName: 'a.jpg',
        mimeType: 'image/jpeg',
        usage: 'main',
        userId: USER_ID,
      }),
    ).rejects.toThrow(/FILE_SERVICE_URL/);
    await expect(client.softDelete('file-1', USER_ID)).rejects.toThrow(/FILE_SERVICE_URL/);
    expect(mock).not.toHaveBeenCalled();
  });

  it(
    'file-service 응답 본문이 길면 잘라서 담는다 — 관리자 화면에 원문 JSON 오류 객체가 그대로 새면 안 된다(§finding5)',
    async () => {
      const longBody = JSON.stringify({ statusCode: 413, message: 'File too large', extra: 'x'.repeat(500) });
      mock.mockResolvedValue(new Response(longBody, { status: 413, statusText: 'Payload Too Large' }));
      const client = new ProductImportFileClient(config());

      await expect(
        client.upload({
          body: Buffer.from([1]),
          fileName: 'a.jpg',
          mimeType: 'image/jpeg',
          usage: 'main',
          userId: USER_ID,
        }),
      ).rejects.toThrow(/^file-service 업로드 실패 \(413 Payload Too Large\): .{1,200}$/s);

      try {
        await client.upload({
          body: Buffer.from([1]),
          fileName: 'a.jpg',
          mimeType: 'image/jpeg',
          usage: 'main',
          userId: USER_ID,
        });
        throw new Error('실패해야 하는 호출이 성공했다');
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        // 상태코드는 여전히 남아 있어야 한다 — 운영자가 원인을 판별하는 유일한 단서다.
        expect(message).toContain('413');
        // 본문은 상한(MAX_ERROR_BODY_CHARS) 을 넘지 않는다.
        const detailPart = message.split(': ')[1] ?? '';
        expect(detailPart.length).toBeLessThanOrEqual(MAX_ERROR_BODY_CHARS);
        expect(detailPart.length).toBeLessThan(longBody.length);
      }
    },
  );

  it('업로드 응답에 id 가 없거나 문자열이 아니면 던진다', async () => {
    mock.mockResolvedValue(new Response(JSON.stringify({ id: 123 }), { status: 200 }));
    const client = new ProductImportFileClient(config());
    await expect(
      client.upload({
        body: Buffer.from([1]),
        fileName: 'a.jpg',
        mimeType: 'image/jpeg',
        usage: 'main',
        userId: USER_ID,
      }),
    ).rejects.toThrow(/id 가 없습니다/);
  });
});
