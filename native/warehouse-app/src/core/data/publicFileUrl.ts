/** 공개 파일 주소의 앞부분. 따로 주지 않으면 core 와 같은 도메인의 file 주소를 쓴다. */
export function filePublicBase(explicit: string | undefined, apiBaseUrl: string): string | null {
  if (explicit) {
    return explicit.replace(/\/+$/, '');
  }

  try {
    const url = new URL(apiBaseUrl);

    if (!url.hostname.startsWith('core.')) {
      return null;
    }

    url.hostname = `file.${url.hostname.slice('core.'.length)}`;

    return url.origin;
  } catch {
    return null;
  }
}

export function publicFileUrl(base: string | null, fileId: string): string | null {
  return base ? `${base}/files/public/${fileId}` : null;
}
