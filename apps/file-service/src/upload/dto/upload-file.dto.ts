import { IsString, IsOptional, IsObject, IsArray, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UploadFileDto {
  @ApiProperty({
    description: 'File context ID',
    enum: [
      'product-image',
      'product-document',
      'user-avatar',
      'user-document',
      'invoice',
      'receipt',
      'shipment-label',
      'business-verification-file',
    ],
    example: 'product-image',
  })
  @IsString()
  contextId: string;

  @ApiProperty({
    description: 'Whether the file should be publicly accessible. ' +
                 'Required for contexts that allow both public and private.',
    required: false,
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

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

