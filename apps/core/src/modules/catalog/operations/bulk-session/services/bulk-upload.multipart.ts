import { BadRequestException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
// 부수효과 임포트다 — `@fastify/multipart` 의 모듈 확장이 `FastifyRequest` 에
// `isMultipart()`/`parts()` 를 붙인다. `import type` 으로는 확장이 적용되지 않는다.
import '@fastify/multipart';
import { MAX_UPLOAD_BYTES } from './bulk-upload.parser';

/**
 * 업로드 라우트가 핸들러에 넘기는 것. 파일 바이트와, 함께 온 필드 중 이 라우트가 쓰는 것뿐.
 */
export interface WorkbookUpload {
  buffer: Buffer;
  fileName: string;
  name?: string;
}

/** `name` 필드 상한. `CreateBulkSessionDto` 의 `@MaxLength(200)` 과 같은 값이어야 한다. */
const MAX_NAME_LENGTH = 200;

/**
 * multipart 업로드에서 워크북 한 개와 `name` 필드를 읽는다.
 *
 * **`@nestjs/platform-express` 의 `FileInterceptor` 를 쓰지 않는 이유**: core 는 Fastify 로
 * 뜬다(`main.ts` 의 `FastifyAdapter`). multer 는 Express 의 `req`(스트림)을 기대해
 * Fastify 요청 래퍼를 받으면 `TypeError: req.on is not a function` 으로 죽는다 — 라우트가
 * 200 을 낼 수가 없다. Fastify 쪽 파서(`@fastify/multipart`, `main.ts` 에서 등록)를 직접 쓴다.
 *
 * **모든 part 를 끝까지 소비해야 한다.** 하나라도 남기면 busboy 스트림이 진행하지 않아
 * 요청이 그대로 매달린다 — 그래서 관심 없는 파일 part 도 `toBuffer()` 로 흘려버린다.
 */
export async function readWorkbookUpload(request: FastifyRequest): Promise<WorkbookUpload> {
  if (!request.isMultipart()) {
    throw new BadRequestException('multipart/form-data 요청이 아닙니다');
  }

  let buffer: Buffer | null = null;
  let fileName = '';
  let truncated = false;
  let name: string | undefined;

  for await (const part of request.parts()) {
    if (part.type === 'file') {
      // 첫 번째 `file` 필드만 취한다. 나머지는 버리되 스트림은 반드시 비운다.
      if (part.fieldname !== 'file' || buffer !== null) {
        await part.toBuffer();
        continue;
      }
      buffer = await part.toBuffer();
      fileName = part.filename;
      // 플러그인 상한(main.ts, 10MB)에 걸리면 예외가 아니라 **잘린 버퍼**가 온다.
      // 여기서 안 보면 잘린 xlsx 가 검증 레인까지 흘러가 "깨진 파일"로 둔갑한다.
      truncated = part.file.truncated;
    } else if (part.fieldname === 'name') {
      name = String(part.value);
    }
  }

  if (truncated) {
    throw new BadRequestException(
      `파일이 너무 큽니다. 최대 ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB 까지 올릴 수 있습니다.`,
    );
  }
  if (buffer === null) throw new BadRequestException('file is required');
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new BadRequestException(
      `파일이 너무 큽니다. 최대 ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB 까지 올릴 수 있습니다.`,
    );
  }

  // 전역 ValidationPipe 가 안 도는 경로라(@Body() DTO 가 없다) 여기서 직접 본다.
  const trimmed = name?.trim();
  if (trimmed !== undefined && trimmed.length > MAX_NAME_LENGTH) {
    throw new BadRequestException(`세션 이름은 ${MAX_NAME_LENGTH}자를 넘을 수 없습니다.`);
  }

  return { buffer, fileName, name: trimmed ? trimmed : undefined };
}
