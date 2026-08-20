import { IsString, IsOptional, IsObject, IsBoolean, IsInt, Min, MaxLength, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PresignUploadDto {
  @ApiProperty({
    description: 'File context ID (validated against file_contexts table)',
    example: 'product-image',
  })
  @IsString()
  @IsNotEmpty()
  contextId: string;

  @ApiProperty({
    description: 'Original file name (extension is used for the stored key)',
    example: 'photo.webp',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fileName: string;

  @ApiProperty({
    description: 'Declared file size in bytes. Verified against the actual object on confirm.',
    example: 1024000,
  })
  @IsInt()
  @Min(1)
  size: number;

  @ApiProperty({
    description: 'Declared MIME type. Signed into the upload URL, so the PUT must use the same Content-Type.',
    example: 'image/webp',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  mimeType: string;

  @ApiProperty({
    description:
      'Whether the file should be publicly accessible. ' + 'Required for contexts that allow both public and private.',
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
}

export class PresignUploadResponseDto {
  @ApiProperty({
    description: 'Pending file ID. Pass to the confirm endpoint after the PUT succeeds.',
    example: '01933e7a-1234-7890-abcd-0123456789ab',
  })
  fileId: string;

  @ApiProperty({
    description: 'Presigned PUT URL for direct upload to storage',
  })
  uploadUrl: string;

  @ApiProperty({
    description: 'Headers that must be sent with the PUT request (they are part of the signature)',
    example: { 'Content-Type': 'image/webp' },
  })
  headers: Record<string, string>;

  @ApiProperty({
    description: 'When the upload URL expires',
  })
  expiresAt: Date;
}

export class ConfirmUploadDto {
  @ApiProperty({
    description: 'File ID returned by the presign endpoint',
    example: '01933e7a-1234-7890-abcd-0123456789ab',
  })
  @IsString()
  @IsNotEmpty()
  fileId: string;
}
