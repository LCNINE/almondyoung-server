import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { z } from 'zod';
import {
  PRODUCT_AI_IMAGE_CONTEXT,
  PRODUCT_AI_IMAGE_MAX_BYTES,
  PRODUCT_AI_IMAGE_TYPES,
  PRODUCT_AI_IMAGES_TOTAL_BYTES,
  type ProductAiAttachment,
} from '@packages/product-ai/images';

export type ProductAiFileAuth = { cookie?: string; authorization?: string };
const metadataSchema = z.object({
  id: z.uuid(),
  originalName: z.string().max(1000),
  mimeType: z.enum(PRODUCT_AI_IMAGE_TYPES),
  size: z.coerce.number().int().positive().max(PRODUCT_AI_IMAGE_MAX_BYTES),
  contextId: z.literal(PRODUCT_AI_IMAGE_CONTEXT),
  status: z.literal('active'),
  isPublic: z.literal(false),
});

@Injectable()
export class ProductAiImageService {
  async copyForProduct(fileIds: string[], auth: ProductAiFileAuth, signal: AbortSignal) {
    const data = await this.load(fileIds, auth, signal);
    const result = new Map<string, { fileId: string; url: string }>();
    for (const [sourceId, dataUrl] of data) {
      const [header, encoded] = dataUrl.split(',');
      const mimeType = header.slice(5, header.indexOf(';'));
      const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1];
      const form = new FormData();
      form.append('file', new Blob([Buffer.from(encoded, 'base64')], { type: mimeType }), `${sourceId}.${extension}`);
      form.append('contextId', 'product-image');
      form.append('isPublic', 'true');
      const base = process.env.FILE_SERVICE_URL ?? 'http://localhost:3080';
      const response = await fetch(`${base.replace(/\/+$/, '')}/files/upload`, {
        method: 'POST',
        body: form,
        redirect: 'error',
        signal,
        headers: {
          ...(auth.cookie ? { Cookie: auth.cookie } : {}),
          ...(auth.authorization ? { Authorization: auth.authorization } : {}),
        },
      });
      if (!response.ok) throw new BadRequestException('상품용 이미지 복사에 실패했습니다. 다시 저장해 주세요.');
      const file = z
        .object({ id: z.uuid(), url: z.url(), isPublic: z.literal(true), status: z.literal('active') })
        .parse(await response.json());
      if (!/^https?:\/\//.test(file.url)) throw new BadRequestException('상품 이미지 주소가 올바르지 않습니다.');
      result.set(sourceId, { fileId: file.id, url: file.url });
    }
    return result;
  }

  private async fileRequest(fileId: string, path: string, auth: ProductAiFileAuth, signal?: AbortSignal) {
    if (!auth.cookie && !auth.authorization) throw new UnauthorizedException('이미지를 읽으려면 다시 로그인해 주세요.');
    const base = process.env.FILE_SERVICE_URL ?? 'http://localhost:3080';
    const response = await fetch(`${base.replace(/\/+$/, '')}/files/${encodeURIComponent(fileId)}/${path}`, {
      headers: {
        ...(auth.cookie ? { Cookie: auth.cookie } : {}),
        ...(auth.authorization ? { Authorization: auth.authorization } : {}),
      },
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new BadRequestException('첨부 이미지에 접근할 수 없습니다. 파일을 다시 첨부해 주세요.');
    return response.json();
  }

  async inspect(fileIds: string[], auth: ProductAiFileAuth, signal?: AbortSignal): Promise<ProductAiAttachment[]> {
    return Promise.all(
      fileIds.map(async (id) => {
        const parsed = metadataSchema.safeParse(await this.fileRequest(id, 'metadata', auth, signal));
        if (!parsed.success || parsed.data.id !== id)
          throw new BadRequestException('첨부는 5MB 이하의 비공개 JPG·PNG·WebP 이미지만 가능합니다.');
        return {
          fileId: id,
          fileName: parsed.data.originalName,
          mimeType: parsed.data.mimeType,
          size: parsed.data.size,
        };
      }),
    );
  }

  async load(fileIds: string[], auth: ProductAiFileAuth, signal: AbortSignal): Promise<Map<string, string>> {
    const files = await this.inspect(fileIds, auth, signal);
    if (files.reduce((sum, file) => sum + file.size, 0) > PRODUCT_AI_IMAGES_TOTAL_BYTES)
      throw new BadRequestException('대화 이미지 합계는 20MB까지 지원합니다. 새 대화를 시작해 주세요.');
    const images = new Map<string, string>();
    // 순차 다운로드로 메모리 사용을 제한한다. URL은 사용자 입력이 아니라 인증된 파일 서비스에서만 받는다.
    for (const file of files) {
      const { signedUrl } = z
        .object({ signedUrl: z.url() })
        .parse(await this.fileRequest(file.fileId, 'download?expiresIn=300', auth, signal));
      const url = new URL(signedUrl);
      if (!['https:', 'http:'].includes(url.protocol))
        throw new BadRequestException('이미지 주소가 올바르지 않습니다.');
      const response = await fetch(url, {
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      });
      if (!response.ok || !response.body) throw new BadRequestException('첨부 이미지를 불러오지 못했습니다.');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > PRODUCT_AI_IMAGE_MAX_BYTES || size > file.size)
            throw new BadRequestException('이미지 크기가 허용 범위를 초과했습니다.');
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      const buffer = Buffer.concat(chunks);
      const type =
        buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
          ? 'image/png'
          : buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255
            ? 'image/jpeg'
            : buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP'
              ? 'image/webp'
              : null;
      if (type !== file.mimeType || size !== file.size)
        throw new BadRequestException('이미지 형식 또는 크기가 일치하지 않습니다.');
      images.set(file.fileId, `data:${type};base64,${buffer.toString('base64')}`);
    }
    return images;
  }
}
