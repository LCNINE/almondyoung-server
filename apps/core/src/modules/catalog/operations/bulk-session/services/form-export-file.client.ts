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
 * 메타데이터 조회 타임아웃. 해석 요청 하나가 최대 50건을 순차로 확인하므로
 * (bulk-image.manager.ts 의 MAX_RESOLUTIONS_PER_REQUEST), 건당 상한이 없으면 한 요청이
 * ALB 60초 천장을 넘길 수 있다. 5초 × 50 = 최악 250초는 여전히 넘지만, 그 상태는
 * file-service 가 죽은 것이고 첫 몇 건에서 이미 실패로 드러난다.
 */
const METADATA_TIMEOUT_MS = 5_000;

/** file-service 메타데이터 응답 중 core 가 쓰는 것만. 전체를 끌고 다니지 않는다. */
export interface BulkFileMetadata {
  id: string;
  contextId: string;
  status: string;
  originalName: string;
}

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

  /**
   * 위임 토큰 서명. `userId` 클레임이 file-service 의 `validatePayload` 에서
   * `sub` 파생 userId 를 덮는다(authentication.service.ts:23-29 — `...payload` 가
   * 마지막에 펼쳐진다). 그 덮어쓴 값이 곧 file-service 가 보는 요청자 신원이다.
   */
  private sign(userId: string, scopes: string[]): string {
    const secret = this.config.get<string>('AUTH_SECRET');
    if (!secret) throw new Error('AUTH_SECRET 이 없어 file-service 토큰을 발급할 수 없습니다');
    return jwtSign({ sub: 'core-bulk-session', userId, scopes }, secret, {
      algorithm: 'HS256',
      expiresIn: '5m',
    });
  }

  /**
   * **워크북(xlsx) 전용** 위임 토큰. `scopes:['master']` 를 실어 file-service 의
   * 소유권 검사를 단락시킨다(`file-access.ts:62` 가 `user.scopes?.includes('master')`
   * 에서 바로 true 를 낸다).
   *
   * 이미지 경로(`ownerToken`)와 달리 여기서 master 가 **필요한** 이유는, 워크북은
   * 파일을 만든 사람과 그걸 쓰는 사람이 정상적으로 다르기 때문이다:
   * - 양식을 만든 사람과 그 양식으로 업로드하는 사람이 다른 것이 정상 업무다
   *   (`bulk-session.manager.ts` 의 `assertExportUsable` 독스트링).
   * - 만료 정리(`form-export.manager.ts` 의 `purgeExpired`)는 잡 소유자와 전혀
   *   다른 맥락(크론)에서 돌면서 남의 잡 파일을 지운다.
   *
   * 그 대신 워크북 경로가 다루는 fileId 는 **전부 core 가 스스로 만들어 DB 에 적어
   * 둔 것**이다 — 외부에서 임의 fileId 를 주입할 통로가 없다.
   */
  private masterToken(userId: string): string {
    return this.sign(userId, ['master']);
  }

  /**
   * **이미지 전용** 위임 토큰. master 스코프를 **일부러 뺀다**.
   *
   * 이미지 경로의 fileId 는 작업자가 `POST /product-bulk-sessions/:id/images/resolve`
   * 로 **통보한 값**이라 core 가 신뢰할 수 없다. master 를 실으면 file-service 의
   * 소유권 검사가 단락돼(`file-access.ts:62`) core 가 남의 파일을 지우는 도구가 된다
   * — 공개 상품 상세 응답이 `fileId` 를 그대로 싣기 때문에 피해자 fileId 는 아무나
   * 수집할 수 있다.
   *
   * master 를 빼면 `file-access.ts:55` 의 `file.uploadedBy === user.userId` 분기가
   * 실제로 강제된다. 정상 파일은 작업자 본인이 admin-web 프록시(`/api/proxy/file/...`,
   * 자기 accessToken 을 그대로 전달)로 올린 것이라 `uploadedBy` 가 일치해 통과하고,
   * 남의 파일은 403 으로 막힌다. 403 은 호출부가 항목 실패/best-effort 로 흡수한다.
   */
  private ownerToken(userId: string): string {
    return this.sign(userId, []);
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
      headers: { Authorization: `Bearer ${this.masterToken(input.userId)}` },
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
      headers: { Authorization: `Bearer ${this.masterToken(userId)}` },
    });
    if (!res.ok) throw new Error(await this.describeFailure('다운로드 URL 발급', res));
    const json: unknown = await res.json();
    const url = this.extractSignedUrl(json);
    if (!url) throw new Error('file-service 응답에 다운로드 URL 이 없습니다');
    return url;
  }

  /**
   * 통보받은 fileId 가 실재하고 어떤 컨텍스트로 올라갔는지 확인한다.
   *
   * **404 는 예외가 아니라 `null`** 이다 — "그런 파일 없음"은 배치 항목 하나의 정상적인
   * 실패 사유이고, 예외로 만들면 오타 한 건이 나머지 49건을 통째로 죽인다.
   *
   * **master 없는 `ownerToken` 을 쓴다** — 통보된 fileId 는 신뢰할 수 없는 입력이라
   * file-service 의 소유권 검사를 살려 둔다. 남의 비공개 파일이면 403 이 오고, 그건
   * `!res.ok` 분기에서 예외가 되어 호출부(BulkImageManager ②)의 try/catch 가 그
   * 항목만 실패로 흡수한다. (상품 이미지 컨텍스트는 `allowPublic` 이라 공개 파일은
   * 여전히 읽힌다 — `loadReadable` 이 `isPublic` 에서 먼저 단락한다. 읽기는 원래
   * 공개이므로 문제가 아니고, 실제 피해가 되는 **삭제**는 `softDeleteOwnedFile` 이
   * 막는다.)
   */
  async getMetadata(fileId: string, userId: string): Promise<BulkFileMetadata | null> {
    const res = await fetch(`${this.baseUrl}/files/${fileId}/metadata`, {
      headers: { Authorization: `Bearer ${this.ownerToken(userId)}` },
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(await this.describeFailure('메타데이터 조회', res));

    const json: unknown = await res.json();
    const meta = this.extractMetadata(json);
    if (!meta) throw new Error('file-service 메타데이터 응답 형태가 다릅니다');
    return meta;
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
   * **워크북(xlsx) 전용 삭제.** 이미지에는 쓰지 마라 — `softDeleteOwnedFile` 이 있고,
   * 둘을 나눈 이유는 그쪽 독스트링에 있다.
   *
   * 만료된 잡을 정리할 때 xlsx 도 함께 지운다(catalog.schema.ts:1016, product_form_exports.expiresAt
   * 주석). file-service 에 고아 파일 정리 잡이 없어(스펙 §2.7) 여기서 안 지우면 S3 에 영구
   * 잔존한다 — product-import-file.client.ts:softDelete 와 동일 패턴(DELETE /files/:fileId,
   * master scope 토큰, 404 는 이미 지워졌다는 뜻이라 성공과 동등 취급 — 정리는 멱등해야 한다).
   * 이건 soft delete 다 — file-service 는 행만 지우고 S3 바이트는 그대로 남는다(스펙 §5.2
   * 기지 결함 목록). 그건 이 클라이언트가 해결할 문제가 아니다.
   */
  async softDelete(fileId: string, userId: string): Promise<void> {
    return this.sendDelete(fileId, this.masterToken(userId));
  }

  /**
   * **이미지 전용 삭제.** `softDelete` 와 라우트·재시도 규약은 같고 **토큰만 다르다** —
   * 이쪽은 master 없는 `ownerToken` 을 써서 file-service 가 `file.uploadedBy` 를 실제로
   * 강제하게 한다(`file-access.ts:47-49` → `isMasterOrOwner`).
   *
   * 왜 둘을 나누는가: 지우려는 fileId 의 **출처가 다르다**.
   * - 워크북(`softDelete`): core 가 스스로 업로드하고 DB 에 적어 둔 fileId. 게다가 만료
   *   정리는 잡 소유자와 다른 맥락에서 돌아 owner 검사를 통과할 수 없다 → master 필요.
   * - 이미지(여기): 작업자가 `images/resolve` 로 **통보한** fileId. master 를 실으면
   *   "공격자가 정한 임의 fileId 를 core 가 master 권한으로 지운다"가 되어, 공개
   *   상품 상세에서 수집한 남의 `fileId` 로 살아있는 상품 이미지를 지울 수 있다.
   *
   * 남의 파일이면 403 이 나서 이 메서드가 던진다. 호출부(② 교체 정리·스윕)는 정리
   * 실패를 best-effort 로 흡수하므로 요청은 실패하지 않는다.
   */
  async softDeleteOwnedFile(fileId: string, userId: string): Promise<void> {
    return this.sendDelete(fileId, this.ownerToken(userId));
  }

  /** 두 삭제 경로가 공유하는 요청부. 다른 것은 위임 토큰뿐이다. */
  private async sendDelete(fileId: string, authToken: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/files/${fileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` },
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

  /** `res.json()` 은 `unknown` 이다 — 캐스팅 대신 `in` narrowing 으로 실제 검증한다(위 두 추출기와 같은 관례). */
  private extractMetadata(json: unknown): BulkFileMetadata | null {
    if (typeof json !== 'object' || json === null) return null;
    if (!('id' in json) || typeof json.id !== 'string') return null;
    if (!('contextId' in json) || typeof json.contextId !== 'string') return null;
    if (!('status' in json) || typeof json.status !== 'string') return null;
    const originalName = 'originalName' in json && typeof json.originalName === 'string' ? json.originalName : '';
    return { id: json.id, contextId: json.contextId, status: json.status, originalName };
  }
}
