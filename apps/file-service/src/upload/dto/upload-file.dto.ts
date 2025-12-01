import { IsEnum, IsOptional, IsObject, IsArray } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { FILE_CONTEXTS, FileContext } from '../../shared/constants/file-contexts';

export class UploadFileDto {
  @ApiProperty({
    description: 'Context in which the file is being uploaded',
    enum: Object.values(FILE_CONTEXTS),
    example: 'product-image',
  })
  @IsEnum(FILE_CONTEXTS)
  context: FileContext;

  @ApiProperty({
    description: 'Additional metadata for the file',
    required: false,
    example: { width: 1920, height: 1080 },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  /**
   * @description
   * VAP-FIX: Changed by Gemini
   * This property is populated by the FileTransformInterceptor.
   * It is not expected from the client directly in the request body,
   * but is attached for internal processing and validation.
   * Marked as optional so validation passes.
   */
  @ApiProperty({ type: 'array', items: { type: 'string', format: 'binary' }, required: false, readOnly: true })
  @IsOptional()
  @IsArray()
  files: any[];
}

