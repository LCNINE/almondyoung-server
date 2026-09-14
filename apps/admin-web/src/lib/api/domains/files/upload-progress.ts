'use client';

/** Fetch does not expose upload progress; keep the same Response contract for auth refresh. */
export function uploadWithProgress(
  url: string,
  init: RequestInit | undefined,
  onProgress: (percent: number | null) => void
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (event) => {
      onProgress(
        event.lengthComputable && event.total > 0
          ? Math.min(100, Math.floor((event.loaded / event.total) * 100))
          : null
      );
    };
    xhr.onload = () => {
      if (!xhr.status) {
        reject(new TypeError('이미지 업로드 연결에 실패했습니다.'));
        return;
      }
      resolve(new Response(xhr.responseText || null, { status: xhr.status }));
    };
    xhr.onerror = () =>
      reject(new TypeError('이미지 업로드 연결에 실패했습니다.'));
    xhr.ontimeout = () =>
      reject(
        new Error('이미지 업로드 시간이 초과됐습니다. 다시 시도해 주세요.')
      );
    xhr.onabort = () =>
      reject(new DOMException('업로드가 취소됐습니다.', 'AbortError'));
    xhr.open(init?.method ?? 'POST', url);
    xhr.withCredentials = init?.credentials === 'include';
    xhr.timeout = 120_000;
    new Headers(init?.headers).forEach((value, key) =>
      xhr.setRequestHeader(key, value)
    );
    onProgress(0);
    xhr.send(init?.body as XMLHttpRequestBodyInit | null | undefined);
  });
}
