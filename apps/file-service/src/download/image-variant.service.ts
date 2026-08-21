import { Injectable, Logger } from '@nestjs/common';
import { BadRequestError } from '@app/shared';
import sharp = require('sharp');
import { StorageService } from '../storage/storage.service';
import { Upload } from '../shared/types/file.types';

export interface ImageVariant {
  format: 'webp';
  width?: number;
}

// 파생본 키가 요청 파라미터 조합 수만큼만 생기도록 폭은 화이트리스트로 제한한다.
export const VARIANT_WIDTHS: readonly number[] = [320, 640, 1024, 1600];

// sharp 로 디코드할 입력 타입. 그 외(gif/svg/video/pdf 등)는 원본 그대로 내보낸다.
const CONVERTIBLE_MIME_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

// 파생 키는 내용이 바뀌지 않으므로 (원본 교체 = 새 fileId) 브라우저/중간 캐시에 영구 캐시를 허용한다.
const DERIVED_CACHE_CONTROL = 'public, max-age=31536000, immutable';

const WEBP_QUALITY = 82;

const HEAD_TIMEOUT_MS = 5_000;
const FETCH_TIMEOUT_MS = 20_000;

@Injectable()
export class ImageVariantService {
  private readonly logger = new Logger(ImageVariantService.name);
  // 같은 파생본을 향한 동시 요청이 인스턴스 안에서 변환을 중복 실행하지 않게 모은다.
  // 인스턴스 간 중복은 허용 — 같은 입력의 재변환이라 마지막 쓰기가 이겨도 내용이 같다.
  private readonly inFlight = new Map<string, Promise<string>>();

  constructor(private readonly storageService: StorageService) {}

  parse(format?: string, width?: string): ImageVariant | null {
    if (format === undefined && width === undefined) {
      return null;
    }
    if (format !== 'webp') {
      throw new BadRequestError(`Unsupported format: ${format ?? '(none)'} (supported: webp)`);
    }
    if (width === undefined) {
      return { format: 'webp' };
    }
    const parsed = Number(width);
    if (!VARIANT_WIDTHS.includes(parsed)) {
      throw new BadRequestError(`Unsupported width: ${width} (supported: ${VARIANT_WIDTHS.join(', ')})`);
    }
    return { format: 'webp', width: parsed };
  }

  /**
   * 파생본 URL 을 돌려준다. 파생본을 만들 수 없거나 만들 이유가 없는 경우는 전부
   * 원본 URL 로 폴백한다 — 이 메서드가 던져서 이미지가 안 뜨는 상황을 만들지 않는다.
   */
  async resolveUrl(file: Upload, variant: ImageVariant): Promise<string> {
    if (!CONVERTIBLE_MIME_TYPES.includes(file.mimeType)) {
      return file.url;
    }
    if (file.mimeType === 'image/webp' && variant.width === undefined) {
      return file.url;
    }

    const derivedKey = this.buildDerivedKey(file, variant);

    try {
      const derivedUrl = this.buildDerivedUrl(file, derivedKey);
      if (!derivedUrl) {
        // url 이 filePath 로 끝나지 않는 비정형 레코드 — 파생 URL 을 조립할 수 없다
        return file.url;
      }

      if (await this.exists(derivedUrl)) {
        return derivedUrl;
      }

      const pending = this.inFlight.get(derivedKey);
      if (pending) {
        return await pending;
      }

      const creating = this.createDerived(file, variant, derivedKey);
      this.inFlight.set(derivedKey, creating);
      try {
        return await creating;
      } finally {
        this.inFlight.delete(derivedKey);
      }
    } catch (error) {
      this.logger.warn(`Image variant fallback to original (${file.id}, ${derivedKey}): ${error.message}`);
      return file.url;
    }
  }

  private buildDerivedKey(file: Upload, variant: ImageVariant): string {
    const tag = variant.width === undefined ? 'orig' : `w${variant.width}`;
    return `derived/${tag}/${file.filePath}.webp`;
  }

  private buildDerivedUrl(file: Upload, derivedKey: string): string | null {
    if (!file.url.endsWith(file.filePath)) {
      return null;
    }
    return `${file.url.slice(0, file.url.length - file.filePath.length)}${derivedKey}`;
  }

  private async exists(url: string): Promise<boolean> {
    try {
      const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(HEAD_TIMEOUT_MS) });
      return response.ok;
    } catch {
      // 존재 확인 실패는 미존재로 취급 — 변환 경로가 이어서 판단한다
      return false;
    }
  }

  private async createDerived(file: Upload, variant: ImageVariant, derivedKey: string): Promise<string> {
    const response = await fetch(file.url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) {
      throw new Error(`Original fetch failed with status ${response.status}`);
    }
    const original = Buffer.from(await response.arrayBuffer());

    // 애니메이션(다중 프레임) webp 는 변환하면 첫 프레임만 남는다 — 원본으로 폴백
    const sourceMeta = await sharp(original, { pages: -1 }).metadata();
    if ((sourceMeta.pages ?? 1) > 1) {
      return file.url;
    }

    // rotate() 는 EXIF orientation 을 픽셀에 굽는다 — webp 파생본엔 EXIF 가 없어 필수
    let pipeline = sharp(original).rotate();
    if (variant.width !== undefined) {
      pipeline = pipeline.resize({ width: variant.width, withoutEnlargement: true });
    }
    const converted = await pipeline.webp({ quality: WEBP_QUALITY }).toBuffer();

    const uploaded = await this.storageService.upload({
      key: derivedKey,
      buffer: converted,
      contentType: 'image/webp',
      isPublic: true,
      cacheControl: DERIVED_CACHE_CONTROL,
      metadata: { sourceFileId: file.id },
    });

    return uploaded.url;
  }
}
