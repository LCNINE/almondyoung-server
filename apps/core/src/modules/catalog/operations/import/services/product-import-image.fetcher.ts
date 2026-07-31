import { Injectable } from '@nestjs/common';
import { assertPublicHttpUrl } from './product-import-image.guard';

/** 공개 URL → 사설 IP 리다이렉트 우회를 막으려면 홉마다 재검사해야 한다. 3회면 충분하다. */
export const MAX_REDIRECT_HOPS = 3;
/**
 * probe 는 바디를 안 받으므로 fetch 보다 훨씬 빠르다 — 별도 상수로 짧게 잡는다.
 * env 로 열지 않는 이유는 노브를 늘리지 않기 위해서다(느린 소싱처는 fetch 타임아웃이 잡는다).
 */
export const PROBE_TIMEOUT_MS = 5_000;

export interface ProbeResult {
  mimeType: string | null;
  sizeBytes: number | null;
}

export interface FetchResult {
  body: Buffer;
  mimeType: string | null;
  sizeBytes: number;
}

/** `image/jpeg; charset=x` → `image/jpeg`. file-service 가 다시 스니핑하므로 참고값이다. */
function normalizeContentType(value: string | null): string | null {
  if (!value) return null;
  const head = value.split(';')[0]?.trim();
  return head ? head.toLowerCase() : null;
}

function parseLength(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

@Injectable()
export class ProductImportImageFetcher {
  /**
   * 리다이렉트를 직접 따라가며 **홉마다** SSRF 가드를 다시 건다.
   * `redirect: 'follow'` 로 두면 중간 홉을 검사할 자리가 없어 공개 URL → 사설 IP
   * 리다이렉트가 그대로 통과한다.
   */
  private async request(
    sourceUrl: string,
    init: { method: 'HEAD' | 'GET'; headers?: Record<string, string>; timeoutMs: number },
  ): Promise<Response> {
    let target = sourceUrl;
    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
      const url = await assertPublicHttpUrl(target);

      let response: Response;
      try {
        response = await globalThis.fetch(url.toString(), {
          method: init.method,
          headers: init.headers,
          redirect: 'manual',
          signal: AbortSignal.timeout(init.timeoutMs),
        });
      } catch (error) {
        // 전송 계층 실패(타임아웃·연결 거부·중단)는 여기서만 발생한다. 그대로 두면
        // 영어 TimeoutError/TypeError 메시지가 product_import_images.error_message 를
        // 거쳐 관리자 화면에 뜬다 — 이 파일의 다른 오류 경로와 규약이 어긋난다.
        const name = error instanceof Error ? error.name : '';
        if (name === 'TimeoutError' || name === 'AbortError') {
          throw new Error(`요청이 제한 시간(${init.timeoutMs}ms) 안에 끝나지 않았습니다: ${target}`);
        }
        const detail = error instanceof Error ? error.message : '알 수 없는 오류';
        throw new Error(`이미지 서버에 연결하지 못했습니다: ${detail}`);
      }

      if (response.status < 300 || response.status >= 400) return response;

      const location = response.headers.get('location');
      if (!location) throw new Error(`리다이렉트 응답에 Location 헤더가 없습니다 (${response.status})`);
      // 다음 홉으로 넘어가기 전에 이 응답의 바디를 비운다 — 안 비우면 스트림이 열린 채
      // 버려져 소켓이 샌다(HEAD 405/501 폴백과 같은 이유).
      await response.body?.cancel().catch(() => undefined);
      // 상대 경로 Location 을 절대 URL 로 만든다 — 그러지 않으면 다음 홉의 URL 파싱이 실패한다.
      target = new URL(location, url).toString();
    }
    throw new Error(`리다이렉트가 상한(${MAX_REDIRECT_HOPS}회)을 넘었습니다: ${sourceUrl}`);
  }

  /**
   * 도달 가능성만 본다. 바디를 받지 않으므로 3,000개도 워커 틱 몇 번이면 끝난다.
   *
   * HEAD 를 거부하는 CDN 이 흔해 405/501 은 `Range: bytes=0-0` GET 으로 폴백한다 —
   * 거부를 "URL 이 죽었다"로 보고하면 MD 가 멀쩡한 URL 을 고치려 든다.
   */
  async probe(sourceUrl: string): Promise<ProbeResult> {
    let response = await this.request(sourceUrl, { method: 'HEAD', timeoutMs: PROBE_TIMEOUT_MS });

    if (response.status === 405 || response.status === 501) {
      // 재대입 전에 원본 바디를 버린다 — 규약을 어기고 HEAD 오류에 바디를 싣는 서버가
      // 있으면 그 스트림이 닫히지 않아 소켓이 샌다.
      await response.body?.cancel().catch(() => undefined);
      response = await this.request(sourceUrl, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
        timeoutMs: PROBE_TIMEOUT_MS,
      });
    }

    if (!response.ok) {
      // throw 전에 바디를 비운다 — 안 비우면 이 경로에서도 스트림이 열린 채 버려진다.
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`URL 에 접근할 수 없습니다: ${response.status} ${response.statusText}`);
    }
    // 바디를 안 쓰므로 소켓을 붙잡지 않게 명시적으로 버린다(Range GET 폴백 경로).
    await response.body?.cancel().catch(() => undefined);

    return {
      mimeType: normalizeContentType(response.headers.get('content-type')),
      sizeBytes: parseLength(response.headers.get('content-length')),
    };
  }

  /**
   * 바디를 받아 Buffer 로 돌려준다. **상한을 넘는 순간 스트림을 끊는다** —
   * Content-Length 만 믿으면 헤더 없는 chunked 응답이 상한을 통과한다.
   */
  async fetch(sourceUrl: string, maxBytes: number, timeoutMs: number): Promise<FetchResult> {
    const response = await this.request(sourceUrl, { method: 'GET', timeoutMs });

    if (!response.ok) {
      // throw 전에 바디를 비운다 — 안 비우면 이 경로에서도 스트림이 열린 채 버려진다.
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`이미지를 내려받지 못했습니다: ${response.status} ${response.statusText}`);
    }

    const declared = parseLength(response.headers.get('content-length'));
    if (declared !== null && declared > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`이미지 크기가 상한(${maxBytes} bytes)을 초과했습니다: ${declared} bytes`);
    }
    if (!response.body) throw new Error('응답에 본문이 없습니다.');

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > maxBytes) {
          throw new Error(`이미지 크기가 상한(${maxBytes} bytes)을 초과했습니다.`);
        }
        chunks.push(value);
      }
    } finally {
      // 상한 초과로 빠져나온 경우 남은 바이트를 계속 받지 않게 끊는다.
      reader.cancel().catch(() => undefined);
    }

    return {
      body: Buffer.concat(chunks),
      mimeType: normalizeContentType(response.headers.get('content-type')),
      sizeBytes: total,
    };
  }
}
