import { uploadWithProgress } from './upload-progress';

class TestRequest {
  upload = {
    onprogress: null as
      | ((event: {
          loaded: number;
          total: number;
          lengthComputable: boolean;
        }) => void)
      | null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  withCredentials = false;
  status = 200;
  responseText = '{"id":"uploaded"}';
  open = jest.fn();
  setRequestHeader = jest.fn();
  send = jest.fn();
}

describe('uploadWithProgress', () => {
  const original = Object.getOwnPropertyDescriptor(
    globalThis,
    'XMLHttpRequest'
  );
  let xhr: TestRequest;
  beforeEach(() => {
    xhr = new TestRequest();
    Object.defineProperty(globalThis, 'XMLHttpRequest', {
      configurable: true,
      value: jest.fn(() => xhr),
    });
  });
  afterAll(() => {
    if (original) Object.defineProperty(globalThis, 'XMLHttpRequest', original);
    else Reflect.deleteProperty(globalThis, 'XMLHttpRequest');
  });

  it('reports actual transferred bytes without sending cookies to signed storage URLs', async () => {
    const onProgress = jest.fn();
    const body = new Blob(['image']);
    const result = uploadWithProgress(
      'https://storage.example/signed',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
        body,
      },
      onProgress
    );
    xhr.upload.onprogress?.({ loaded: 25, total: 100, lengthComputable: true });
    expect(onProgress.mock.calls).toEqual([[0], [25]]);
    expect(xhr.withCredentials).toBe(false);
    expect(xhr.send).toHaveBeenCalledWith(body);
    expect(xhr.setRequestHeader).toHaveBeenCalledWith(
      'content-type',
      'image/png'
    );
    xhr.onload?.();
    expect(await (await result).json()).toEqual({ id: 'uploaded' });
  });

  it('preserves authenticated proxy requests and does not invent a percent for unknown totals', async () => {
    const onProgress = jest.fn();
    const result = uploadWithProgress(
      '/api/proxy/file/files/upload',
      {
        method: 'POST',
        credentials: 'include',
        body: new FormData(),
      },
      onProgress
    );
    xhr.upload.onprogress?.({ loaded: 25, total: 0, lengthComputable: false });
    expect(onProgress).toHaveBeenLastCalledWith(null);
    expect(xhr.withCredentials).toBe(true);
    // The browser must choose the multipart boundary.
    expect(xhr.setRequestHeader).not.toHaveBeenCalled();
    xhr.status = 401;
    xhr.onload?.();
    expect((await result).status).toBe(401);
  });

  it('rejects network failures so the existing proxy fallback can run', async () => {
    const result = uploadWithProgress(
      'https://storage.example/signed',
      { method: 'PUT' },
      jest.fn()
    );
    xhr.onerror?.();
    await expect(result).rejects.toBeInstanceOf(TypeError);
  });
});
