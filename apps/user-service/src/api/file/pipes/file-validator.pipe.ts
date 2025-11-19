import { MultipartFile } from '@fastify/multipart';
import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import {
  ALLOWED_MIME_TYPES,
  FILE_SIZE_LIMIT,
} from '../../../constants/file.constants';
import { S3_FOLDER_NAMES, S3FolderName } from '../constants';
import { ValidatedFile } from '../interfaces/validated-file.interface';

@Injectable()
export class FileValidatorPipe implements PipeTransform {
  async transform(file: MultipartFile): Promise<ValidatedFile> {
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

    // folderName 필드 추출
    const folderNameField = file.fields?.folderName as any;
    let folderName: string = '';

    if (Array.isArray(folderNameField)) {
      folderName = folderNameField[0]?.value || '';
    } else if (folderNameField?.value) {
      folderName = folderNameField.value;
    }

    if (!folderName) {
      throw new BadRequestException('folderName is required');
    }

    // folderName 유효성 검증(런타임에 검즘하기 위해)
    const validFolderNames = Object.keys(S3_FOLDER_NAMES);
    if (!validFolderNames.includes(folderName)) {
      throw new BadRequestException(
        `Invalid folderName. Allowed values: ${validFolderNames.join(', ')}`,
      );
    }

    return {
      ...file,
      buffer,
      folderName: folderName as S3FolderName,
    };
  }
}
