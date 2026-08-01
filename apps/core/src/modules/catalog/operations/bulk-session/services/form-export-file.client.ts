import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sign as jwtSign } from 'jsonwebtoken';

export const BULK_FORM_CONTEXT_ID = 'product-bulk-form';
const MAX_ERROR_BODY_CHARS = 200;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/**
 * `download` 의 실제 GET(서명 URL → S3)에 거는 타임아웃. 워크북 자체가 최대 10MB
 * (bulk-upload.parser.ts 의 MAX_UPLOAD_BYTES)라 정상 다운로드는 수 초 안에 끝난다 —
 * 30초는 그보다 몇 배의 여유를 주면서도, 멈춘 S3 연결이 (다음 태스크의) 검증 워커
 * 슬라이스 하나를 통째로 붙잡는 것은 막는다.
 */
const DOWNLOAD_TIMEOUT_MS = 30_000;

/**
 * 양식 워크북을 file-service 에 올린다.
 *
 * 기존 library FileServiceClient(다운로드 위임 전용)와 분리한 이유는 토큰 클레임이
 * 다르기 때문이다 — uploads.uploaded_by 가 NOT NULL uuid 인데 서비스 토큰에는 sub 만
 * 있어, 요청자 userId 를 클레임에 실어야 업로드가 죽지 않는다
 * (authentication.service.ts 의 validatePayload 가 payload 를 마지막에 펼치므로
 * `userId` 클레임이 `sub` 파생값을 덮는다).
 */
@Injectable()
export class FormExportFileClient {
  private readonly logger = new Logger(FormExportFileClient.name);

  constructor(private readonly config: ConfigService) {}

  private token(userId: string): string {
    const secret = this.config.get<string>('AUTH_SECRET');
    if (!secret) throw new Error('AUTH_SECRET 이 없어 file-service 토큰을 발급할 수 없습니다');
    return jwtSign({ sub: 'core-bulk-session', userId, scopes: ['master'] }, secret, {
      algorithm: 'HS256',
      expiresIn: '5m',
    });
  }

  private get baseUrl(): string {
    const url = this.config.get<string>('FILE_SERVICE_URL');
    if (!url) throw new Error('FILE_SERVICE_URL 이 설정되지 않았습니다');
    return url.replace(/\/$/, '');
  }

  async upload(input: { buffer: Buffer; fileName: string; userId: string }): Promise<{ fileId: string }> {
    const form = new FormData();
    // Buffer 를 그대로 Blob 에 넘기면 TS 가 ArrayBufferLike(SharedArrayBuffer 포함
    // 가능성)를 BlobPart 로 못 좁혀 타입 에러를 낸다 — Uint8Array 로 한 번 복사해
    // 순수 ArrayBuffer 로 만든다 (product-import-file.client.ts 와 동일한 패턴).
    form.append('file', new Blob([new Uint8Array(input.buffer)], { type: XLSX_MIME }), input.fileName);
    form.append('contextId', BULK_FORM_CONTEXT_ID);

    // Content-Type 을 직접 세팅하지 않는다 — FormData 를 넘기면 undici 가 boundary 를
    // 포함해 알아서 붙인다. 손으로 붙이면 boundary 가 빠져 서버가 파싱에 실패한다.
    const res = await fetch(`${this.baseUrl}/files/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token(input.userId)}` },
      body: form,
    });

    if (!res.ok) throw new Error(await this.describeFailure('업로드', res));

    const json: unknown = await res.json();
    const fileId = this.extractFileId(json);
    if (!fileId) throw new Error('file-service 응답에 fileId 가 없습니다');
    return { fileId };
  }

  /**
   * 실제 file-service 라우트는 `GET /files/:fileId/download` 이고 응답 필드는
   * `signedUrl` 이다 (apps/file-service/src/download/download.controller.ts,
   * dto/signed-url-response.dto.ts). `/download-url` · `url`/`downloadUrl` 은
   * 브리프 초안의 추정이었을 뿐 실제 라우트가 아니라 여기서 바로잡는다 — 기존
   * library FileServiceClient.getDownloadUrl 이 이미 같은 라우트/필드를 쓴다.
   *
   * `download=true` 를 반드시 붙인다 — S3 키는 UUID 라(path-builder.service.ts),
   * 이 쿼리파라미터 없이는 download.service.ts 가 `Content-Disposition` 을 아예
   * 안 실어(getSignedUrl:30-33) 브라우저가 업로드 시 지정한 원본 파일명
   * (`상품일괄양식_YYYY-MM-DD.xlsx`, form-export-job.manager.ts:120) 대신 UUID
   * 파일명으로 저장한다. library FileServiceClient.getDownloadUrl:98 이 이미 같은
   * 파라미터를 쓴다 — 그 선례를 따른다.
   */
  async getDownloadUrl(fileId: string, userId: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/files/${fileId}/download?download=true`, {
      headers: { Authorization: `Bearer ${this.token(userId)}` },
    });
    if (!res.ok) throw new Error(await this.describeFailure('다운로드 URL 발급', res));
    const json: unknown = await res.json();
    const url = this.extractSignedUrl(json);
    if (!url) throw new Error('file-service 응답에 다운로드 URL 이 없습니다');
    return url;
  }

  /**
   * 업로드된 워크북을 바이트로 가져온다. 검증 레인이 파싱하려면 파일이 필요하고,
   * file-service 는 S3 서명 URL 만 주므로 두 번 왕복한다(URL 발급 → 실제 GET).
   *
   * 실패 시 `describeFailure` 를 그대로 재사용하지 않는다 — 이 응답은 file-service 가
   * 아니라 S3(서명 URL) 것이라 "file-service ... 실패" 문구가 원인을 잘못 가리킨다.
   * 대신 같은 본문-절단·로깅 로직(`readTruncatedBody`)만 공유하고 메시지는 여기서
   * 직접 짓는다 — 검증 레인이 멈췄을 때 운영자가 로그의 상태코드+본문으로 서명 만료
   * (403)와 키 부재(404)를 구분할 수 있어야 한다.
   */
  async download(fileId: string, userId: string): Promise<Buffer> {
    const url = await this.getDownloadUrl(fileId, userId);
    const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!res.ok) {
      const body = await this.readTruncatedBody(res);
      this.logger.warn(`업로드 파일 다운로드 실패 ${res.status}: ${body}`);
      throw new Error(`업로드 파일 다운로드 실패 (${res.status})`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  /**
   * 만료된 잡을 정리할 때 xlsx 도 함께 지운다(catalog.schema.ts:1016, product_form_exports.expiresAt
   * 주석). file-service 에 고아 파일 정리 잡이 없어(스펙 §2.7) 여기서 안 지우면 S3 에 영구
   * 잔존한다 — product-import-file.client.ts:softDelete 와 동일 패턴(DELETE /files/:fileId,
   * master scope 토큰, 404 는 이미 지워졌다는 뜻이라 성공과 동등 취급 — 정리는 멱등해야 한다).
   * 이건 soft delete 다 — file-service 는 행만 지우고 S3 바이트는 그대로 남는다(스펙 §5.2
   * 기지 결함 목록). 그건 이 클라이언트가 해결할 문제가 아니다.
   */
  async softDelete(fileId: string, userId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/files/${fileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${this.token(userId)}` },
    });
    if (res.ok || res.status === 404) return;
    throw new Error(await this.describeFailure('삭제', res));
  }

  /** file-service 원문 JSON 이 관리자 화면까지 새지 않게 자른다. */
  private async describeFailure(action: string, res: Response): Promise<string> {
    const body = await this.readTruncatedBody(res);
    this.logger.warn(`file-service ${action} 실패 ${res.status}: ${body}`);
    return `file-service ${action} 실패 (${res.status})`;
  }

  /**
   * 실패 응답 본문을 잘라 돌려준다. `describeFailure`(file-service 응답)와
   * `download`(S3 응답) 양쪽이 쓴다 — 본문을 읽지 않고 버리면 undici 커넥션이 GC 까지
   * 물려 소켓이 샌다는 점도, 절단 길이도 두 경로가 같아 여기 하나로 둔다. 메시지 문구
   * ("file-service ..." vs "업로드 파일 다운로드 ...")는 실패 원인 서버가 서로 달라
   * 호출부가 각자 짓는다.
   */
  private async readTruncatedBody(res: Response): Promise<string> {
    try {
      return (await res.text()).slice(0, MAX_ERROR_BODY_CHARS);
    } catch {
      return '(본문 없음)';
    }
  }

  /**
   * `res.json()` 은 `unknown` 을 반환한다 — `as { id?: string }` 캐스팅 대신 TS 의 `in`
   * 연산자 narrowing 으로 필드 존재/타입을 실제로 검증한다 (product-import-file.client.ts:111-116
   * 과 동일 패턴). 업로드 응답은 `id` 가 기본이고 `fileId` 는 방어적 대체 필드명.
   */
  private extractFileId(json: unknown): string | null {
    if (typeof json === 'object' && json !== null && 'id' in json && typeof json.id === 'string') {
      return json.id;
    }
    if (typeof json === 'object' && json !== null && 'fileId' in json && typeof json.fileId === 'string') {
      return json.fileId;
    }
    return null;
  }

  /** download 응답의 실제 필드명은 `signedUrl` 이다 — 위와 동일한 이유로 캐스팅 대신 narrowing. */
  private extractSignedUrl(json: unknown): string | null {
    if (typeof json === 'object' && json !== null && 'signedUrl' in json && typeof json.signedUrl === 'string') {
      return json.signedUrl;
    }
    return null;
  }
}
