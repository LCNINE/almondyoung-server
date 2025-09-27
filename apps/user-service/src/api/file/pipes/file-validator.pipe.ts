import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { MultipartFile } from '@fastify/multipart';
import {
  ALLOWED_MIME_TYPES,
  FILE_SIZE_LIMIT,
} from '../../../constants/file.constants';

@Injectable()
export class FileValidatorPipe implements PipeTransform {
  async transform(file: MultipartFile) {
    if (!file) {
      throw new BadRequestException('파일이 제공되지 않았습니다.');
    }

    // 파일 크기 검증
    const buffer = await file.toBuffer();
    if (buffer.length > FILE_SIZE_LIMIT) {
      throw new BadRequestException(
        `파일 크기는 ${FILE_SIZE_LIMIT} 를 초과할 수 없습니다.`,
      );
    }

    // MIME 타입 검증
    if (
      !ALLOWED_MIME_TYPES.includes(
        file.mimetype as (typeof ALLOWED_MIME_TYPES)[number],
      )
    ) {
      throw new BadRequestException(
        `지원하지 않는 파일 형식입니다. 허용된 형식: ${ALLOWED_MIME_TYPES.join(', ')}`,
      );
    }

    return {
      ...file,
      buffer,
    };
  }
}
