import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sign as jwtSign } from 'jsonwebtoken';
import { ProductImageUsage } from '../dto/import.types';

/**
 * 용도별 file-service 컨텍스트. 같은 이미지라도 용도에 따라 통과 여부와 저장 경로가 갈린다
 * (apps/file-service/src/database/default-file-contexts.ts).
 */
export const IMAGE_CONTEXT_BY_USAGE: Record<ProductImageUsage, string> = {
  main: 'product-image',
  description: 'product-description-image',
};

/** 컨텍스트별 maxFileSize. 이보다 큰 바이트를 끌어와도 file-service 가 거부하므로 미리 끊는다. */
export const MAX_BYTES_BY_USAGE: Record<ProductImageUsage, number> = {
  main: 10 * 1024 * 1024,
  description: 20 * 1024 * 1024,
};

/**
 * 실패 메시지에 붙이는 응답 본문 길이 상한. file-service 오류 본문은 JSON 객체 그대로라
 * 안 자르면(예: 413 의 상세 메시지) 관리자 화면이 지저분해진다.
 */
export const MAX_ERROR_BODY_CHARS = 200;

/**
 * 임포트 전용 file-service 클라이언트.
 *
 * library 의 `FileServiceClient` 를 재사용하지 않는다 — 그쪽은 **다운로드 위임** 전용이고
 * 토큰 클레임 구성이 다르다(스펙 §3.2.5).
 *
 * ⚠️ `uploads.uploaded_by` 가 **NOT NULL uuid** 인데 업로드 컨트롤러는 `@User().userId` 를
 * 그대로 쓴다. `sub` 만 있는 서비스 토큰으로 올리면 NOT NULL 위반으로 죽는다. 그래서 세션의
 * `uploaded_by` 를 `userId` 클레임으로 싣는다 — `validatePayload` 가 payload 를 마지막에
 * 펼치므로 이 값이 `sub` 파생값을 덮는다(authentication.service.ts:23-29).
 * 결과적으로 이미지가 워크북을 올린 MD 에게 귀속돼 소유자 기반 접근이 자연스럽게 동작한다.
 */
@Injectable()
export class ProductImportFileClient {
  constructor(private readonly config: ConfigService) {}

  private mintServiceToken(userId: string): string {
    const secret = this.config.get<string>('AUTH_SECRET');
    if (!secret) {
      throw new Error(
        'ProductImportFileClient 는 서비스 토큰 발급에 AUTH_SECRET(file-service 와 공유하는 HS256 시크릿)이 필요합니다.',
      );
    }
    return jwtSign(
      {
        // sub 가 없으면 validatePayload 가 401 을 던진다.
        sub: 'core-product-import-service',
        // uploads.uploaded_by 로 그대로 들어간다.
        userId,
        // 삭제 위임에 쓰인다 — file-access.ts:62 가 scopes:['master'] 를 명시 허용한다.
        scopes: ['master'],
      },
      secret,
      { algorithm: 'HS256', expiresIn: '1m' },
    );
  }

  private baseUrl(): string {
    const url = this.config.get<string>('FILE_SERVICE_URL');
    if (!url) throw new Error('FILE_SERVICE_URL 이 설정되지 않았습니다.');
    return url.replace(/\/+$/, '');
  }

  private assertUserId(userId: string): void {
    if (!userId || userId.trim() === '') {
      // 옛 세션은 uploaded_by 가 NULL 일 수 있다(컬럼이 nullable). 빈 문자열로 올리면
      // file-service 가 uuid 파싱에서 500 을 내므로, 원인이 보이는 메시지로 여기서 막는다.
      throw new Error('업로더(uploaded_by)가 없는 세션이라 이미지를 올릴 수 없습니다.');
    }
  }

  async upload(input: {
    body: Buffer;
    fileName: string;
    mimeType: string;
    usage: ProductImageUsage;
    userId: string;
  }): Promise<{ fileId: string }> {
    this.assertUserId(input.userId);
    const token = this.mintServiceToken(input.userId);

    const form = new FormData();
    // Buffer → Blob 은 Node 22 전역 Blob 으로 충분하다. Buffer 를 그대로 넘기면 TS 가
    // ArrayBufferLike(SharedArrayBuffer 포함 가능성)를 BlobPart 로 못 좁혀 타입 에러를
    // 낸다 — Uint8Array 로 한 번 복사해 순수 ArrayBuffer 로 만든다. multer 가
    // originalname 으로 확장자를 뽑으므로(upload.service.ts:72) fileName 에 확장자가
    // 있어야 한다.
    form.append('file', new Blob([new Uint8Array(input.body)], { type: input.mimeType }), input.fileName);
    form.append('contextId', IMAGE_CONTEXT_BY_USAGE[input.usage]);
    // 두 컨텍스트 모두 allowPublic:true / allowPrivate:false 라 true 만 통과한다.
    form.append('isPublic', 'true');

    // Content-Type 을 직접 세팅하지 않는다 — FormData 를 넘기면 undici 가 boundary 를
    // 포함한 헤더를 만든다. 손으로 넣으면 boundary 가 빠져 파싱이 깨진다.
    const res = await globalThis.fetch(`${this.baseUrl()}/files/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    if (!res.ok) {
      throw new Error(await this.describeFailure('업로드', res));
    }

    const json: unknown = await res.json();
    const fileId =
      typeof json === 'object' && json !== null && 'id' in json && typeof json.id === 'string'
        ? json.id
        : null;
    if (!fileId) throw new Error('file-service 업로드 응답에 id 가 없습니다.');
    return { fileId };
  }

  /**
   * 취소 정리용 soft delete. file-service 에 고아 파일 정리 잡이 없어(스펙 §2.8)
   * 안 지우면 S3 에 영구 잔존한다.
   */
  async softDelete(fileId: string, userId: string): Promise<void> {
    this.assertUserId(userId);
    const token = this.mintServiceToken(userId);
    const res = await globalThis.fetch(`${this.baseUrl()}/files/${fileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    // 404 는 이미 지워졌다는 뜻이라 성공과 구분할 실익이 없다 — 정리는 멱등해야 한다.
    if (res.ok || res.status === 404) return;
    throw new Error(await this.describeFailure('삭제', res));
  }

  /**
   * file-service 실패 메시지를 만든다. 이 문자열은 product_import_images.error_message →
   * unresolvedImageError → product_import_items.error_message 를 거쳐 세션 상세 화면까지
   * 그대로 노출된다. 상태코드는 운영자가 원인을 판별하는 데 쓰이므로 남기고, 본문은
   * file-service 가 그대로 뱉는 JSON 오류 객체라 길이를 제한해 덧붙인다 — 안 그러면
   * 413 같은 응답이 관리자 화면에 원문 그대로 샌다.
   */
  private async describeFailure(action: string, res: Response): Promise<string> {
    const body = await res.text().catch(() => '');
    const detail = body.trim().slice(0, MAX_ERROR_BODY_CHARS);
    return `file-service ${action} 실패 (${res.status} ${res.statusText})${detail ? `: ${detail}` : ''}`;
  }
}
