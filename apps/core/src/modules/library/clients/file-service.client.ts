import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sign as jwtSign } from 'jsonwebtoken';

/**
 * Core → file-service 의 service-to-service client.
 *
 * Library 다운로드 흐름:
 *  1) storefront 가 core 의 `/library/ownerships/:id/download` 호출
 *  2) core 가 사용자 본인 + exercise 검증
 *  3) **이 client** 가 file-service `/files/:fileId/download` 호출 — master scope 의
 *     단명 HS256 서비스 토큰 발급 (AUTH_SECRET 공유) → signed URL 응답 받음
 *  4) signed URL 의 바이트를 fetch → 클라이언트로 stream
 *
 * 왜 토큰을 매 호출마다 발급하는가: file-service 가 (소유자 || master scope) 만 허용하는데,
 * 디지털 자산의 uploadedBy 는 admin 이고 storefront 사용자는 둘 다 아니다. core 가 권한 검사를
 * 마쳤음을 신뢰하는 별도의 internal endpoint 를 만들 수도 있지만 그건 스코프 확장.
 * 짧은 만료(1m)의 master 토큰으로 위임만 한다.
 */
@Injectable()
export class FileServiceClient {
  private readonly logger = new Logger(FileServiceClient.name);

  constructor(private readonly config: ConfigService) {}

  private mintServiceToken(): string {
    const secret = this.config.get<string>('AUTH_SECRET');
    if (!secret) {
      throw new Error(
        'FileServiceClient requires AUTH_SECRET (HS256 shared with file-service) to mint a service token.',
      );
    }
    return jwtSign(
      {
        sub: 'core-library-service',
        scopes: ['master'],
      },
      secret,
      { algorithm: 'HS256', expiresIn: '1m' },
    );
  }

  private baseUrl(): string {
    const url = this.config.get<string>('FILE_SERVICE_URL');
    if (!url) {
      throw new Error('FILE_SERVICE_URL is not configured');
    }
    return url.replace(/\/+$/, '');
  }

  /**
   * file-service 의 download endpoint 를 호출해 signed URL 을 얻고, 그 URL 의 바이트를
   * 가져와 (stream, contentType, contentLength) 로 돌려준다.
   */
  async fetchFile(fileId: string): Promise<{
    stream: ReadableStream<Uint8Array>;
    contentType: string;
    contentLength: number | null;
  }> {
    const token = this.mintServiceToken();
    const metaRes = await fetch(`${this.baseUrl()}/files/${fileId}/download?expiresIn=60`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!metaRes.ok) {
      const body = await metaRes.text().catch(() => '');
      throw new Error(`file-service download endpoint failed: ${metaRes.status} ${metaRes.statusText} — ${body}`);
    }
    const meta = (await metaRes.json()) as { signedUrl: string };
    if (!meta.signedUrl) {
      throw new Error('file-service response missing signedUrl');
    }

    const fileRes = await fetch(meta.signedUrl, { method: 'GET' });
    if (!fileRes.ok) {
      throw new Error(`signed URL fetch failed: ${fileRes.status} ${fileRes.statusText} — ${meta.signedUrl}`);
    }
    if (!fileRes.body) {
      throw new Error('signed URL response has no body');
    }

    const contentType = fileRes.headers.get('content-type') ?? 'application/octet-stream';
    const lenHeader = fileRes.headers.get('content-length');
    const contentLength = lenHeader ? Number(lenHeader) : null;

    return { stream: fileRes.body, contentType, contentLength };
  }

  /**
   * file-service 의 metadata 를 가져온다 (다운로드 파일명 결정용).
   */
  async fetchMetadata(fileId: string): Promise<{
    fileName: string;
    originalName: string | null;
    mimeType: string | null;
    status: string | null;
    contextId: string | null;
  }> {
    const token = this.mintServiceToken();
    const res = await fetch(`${this.baseUrl()}/files/${fileId}/metadata`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`file-service metadata endpoint failed: ${res.status} ${res.statusText} — ${body}`);
    }
    const meta = (await res.json()) as {
      fileName?: string;
      originalName?: string;
      mimeType?: string;
      status?: string;
      contextId?: string;
    };
    return {
      fileName: meta.fileName ?? meta.originalName ?? fileId,
      originalName: meta.originalName ?? null,
      mimeType: meta.mimeType ?? null,
      status: meta.status ?? null,
      contextId: meta.contextId ?? null,
    };
  }
}
