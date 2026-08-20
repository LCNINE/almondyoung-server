jest.mock('../../fetch-with-refresh', () => ({ fetchWithRefresh: jest.fn() }));

import { fetchWithRefresh } from '../../fetch-with-refresh';
import { uploadFileToFileService } from './upload.client';

const mockedFetchWithRefresh = fetchWithRefresh as jest.Mock;

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const uploadedFile = {
  id: 'f1',
  url: 'https://bucket.example/banners/f1.webp',
  fileName: 'f1.webp',
  size: 3,
  status: 'active',
  isPublic: true,
};

const presignBody = {
  fileId: 'f1',
  uploadUrl: 'https://bucket.example/signed-put',
  headers: { 'Content-Type': 'image/webp' },
  expiresAt: new Date().toISOString(),
};

function smallFile() {
  return new File([new Uint8Array(3)], 'x.webp', { type: 'image/webp' });
}

// 프록시(Lambda) 상한(4MB)을 넘는 크기 — 폴백이 불가능한 구간
function largeFile() {
  return new File([new Uint8Array(5 * 1024 * 1024)], 'big.webp', { type: 'image/webp' });
}

describe('uploadFileToFileService', () => {
  let mockedFetch: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedFetch = jest.fn();
    (globalThis as { fetch: unknown }).fetch = mockedFetch;
  });

  it('presign → 직접 PUT → confirm 순서로 올리고 confirm 응답을 돌려준다', async () => {
    mockedFetchWithRefresh.mockImplementation(async (url: string) =>
      url.endsWith('/files/upload/presign')
        ? jsonResponse(200, presignBody)
        : jsonResponse(200, uploadedFile)
    );
    mockedFetch.mockResolvedValue({ ok: true, status: 200 });

    const result = await uploadFileToFileService(smallFile(), {
      contextId: 'banner-image',
      isPublic: true,
    });

    expect(result).toEqual(uploadedFile);
    expect(mockedFetch).toHaveBeenCalledWith(
      'https://bucket.example/signed-put',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'image/webp' },
      })
    );
    const confirmCall = mockedFetchWithRefresh.mock.calls.find(([url]) =>
      (url as string).endsWith('/files/upload/confirm')
    );
    expect(confirmCall?.[1]?.body).toBe(JSON.stringify({ fileId: 'f1' }));
  });

  it('presign 이 404(구버전 서버·직접 업로드 미지원)면 기존 프록시 업로드로 폴백한다', async () => {
    mockedFetchWithRefresh.mockImplementation(async (url: string) =>
      url.endsWith('/files/upload/presign')
        ? jsonResponse(404, { message: 'Not Found' })
        : jsonResponse(200, uploadedFile)
    );

    const result = await uploadFileToFileService(smallFile(), {
      contextId: 'banner-image',
      isPublic: true,
    });

    expect(result).toEqual(uploadedFile);
    expect(mockedFetch).not.toHaveBeenCalled();

    const proxyCall = mockedFetchWithRefresh.mock.calls.find(
      ([url]) => url === '/api/proxy/file/files/upload'
    );
    expect(proxyCall).toBeDefined();
    expect(proxyCall?.[1]?.body).toBeInstanceOf(FormData);
  });

  it('presign 이 400 으로 거부하면 서버 메시지를 실어 던지고 프록시로 재시도하지 않는다', async () => {
    mockedFetchWithRefresh.mockResolvedValue(
      jsonResponse(400, { message: 'File size too large for Banner Image. Max: 10.0MB' })
    );

    await expect(
      uploadFileToFileService(smallFile(), { contextId: 'banner-image', isPublic: true })
    ).rejects.toThrow('File size too large');

    expect(mockedFetchWithRefresh).toHaveBeenCalledTimes(1);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('직접 PUT 이 실패해도 프록시 상한 이내면 프록시 업로드로 폴백한다', async () => {
    mockedFetchWithRefresh.mockImplementation(async (url: string) =>
      url.endsWith('/files/upload/presign')
        ? jsonResponse(200, presignBody)
        : jsonResponse(200, uploadedFile)
    );
    mockedFetch.mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await uploadFileToFileService(smallFile(), {
      contextId: 'banner-image',
      isPublic: true,
    });

    expect(result).toEqual(uploadedFile);
    const proxyCall = mockedFetchWithRefresh.mock.calls.find(
      ([url]) => url === '/api/proxy/file/files/upload'
    );
    expect(proxyCall).toBeDefined();
  });

  it('직접 PUT 이 실패하고 프록시 상한도 넘는 크기면 폴백 없이 안내 문구로 실패한다', async () => {
    mockedFetchWithRefresh.mockResolvedValue(jsonResponse(200, presignBody));
    mockedFetch.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(
      uploadFileToFileService(largeFile(), { contextId: 'banner-image', isPublic: true })
    ).rejects.toThrow('줄여서 올려주세요');

    const proxyCall = mockedFetchWithRefresh.mock.calls.find(
      ([url]) => url === '/api/proxy/file/files/upload'
    );
    expect(proxyCall).toBeUndefined();
  });

  it('confirm 이 400 으로 거부하면 서버 메시지를 실어 던진다', async () => {
    mockedFetchWithRefresh.mockImplementation(async (url: string) =>
      url.endsWith('/files/upload/presign')
        ? jsonResponse(200, presignBody)
        : jsonResponse(400, { message: 'File has not been uploaded to storage' })
    );
    mockedFetch.mockResolvedValue({ ok: true, status: 200 });

    await expect(
      uploadFileToFileService(smallFile(), { contextId: 'banner-image', isPublic: true })
    ).rejects.toThrow('File has not been uploaded');
  });
});
