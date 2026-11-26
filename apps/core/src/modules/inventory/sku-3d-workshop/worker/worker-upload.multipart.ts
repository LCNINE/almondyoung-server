import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
// 부수효과 임포트 — @fastify/multipart 가 FastifyRequest 에 parts() 를 붙인다
import '@fastify/multipart';

export const WORKER_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

export type WorkerUpload = { bytes: Buffer; name: string; mimeType: string; leaseToken: string };

// core 는 Fastify 라 multer(FileInterceptor) 를 못 쓴다. part 는 전부 끝까지 소비해야 요청이 매달리지 않는다
export async function readWorkerUpload(request: FastifyRequest): Promise<WorkerUpload> {
  if (!request.isMultipart()) {
    throw new BadRequestException('multipart/form-data 요청이 아니에요');
  }

  let file: Omit<WorkerUpload, 'leaseToken'> | null = null;
  let leaseToken = '';

  try {
    for await (const part of request.parts({ limits: { fileSize: WORKER_UPLOAD_MAX_BYTES, files: 1 } })) {
      if (part.type === 'file') {
        const bytes = await part.toBuffer();

        if (part.fieldname === 'file' && file === null) {
          file = { bytes, name: part.filename, mimeType: part.mimetype };
        }

        continue;
      }

      if (part.fieldname === 'leaseToken' && typeof part.value === 'string') {
        leaseToken = part.value;
      }
    }
  } catch (error) {
    // @fastify/multipart 는 이름이 아니라 code 로 구분된다
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;

    if (code === 'FST_REQ_FILE_TOO_LARGE' || code === 'FST_FILES_LIMIT' || code === 'FST_PARTS_LIMIT') {
      throw new PayloadTooLargeException(`파일은 하나, ${WORKER_UPLOAD_MAX_BYTES} 바이트까지예요`);
    }

    throw error;
  }

  if (!file) {
    throw new BadRequestException('file 이 필요해요');
  }

  if (!/^[0-9a-f-]{36}$/i.test(leaseToken)) {
    throw new BadRequestException('leaseToken 이 필요해요');
  }

  return { ...file, leaseToken };
}
