import { ApiProperty } from '@nestjs/swagger';

export class FileMetadataResponseDto {
  @ApiProperty({
    description: 'File ID',
    example: '01933e7a-1234-7890-abcd-0123456789ab',
  })
  id: string;

  @ApiProperty({
    description: 'Stored file name',
    example: '01933e7a-1234-7890-abcd-0123456789ab.jpg',
  })
  fileName: string;

  @ApiProperty({
    description: 'Original file name',
    example: 'product-photo.jpg',
  })
  originalName: string;

  @ApiProperty({
    description: 'MIME type',
    example: 'image/jpeg',
  })
  mimeType: string;

  @ApiProperty({
    description: 'File size in bytes',
    example: 1024000,
  })
  size: number;

  @ApiProperty({
    description: 'File URL',
    example: 'https://bucket.s3.amazonaws.com/products/images/2025/01/file.jpg',
  })
  url: string;

  @ApiProperty({
    description: 'File status',
    enum: ['pending', 'active', 'deleted'],
    example: 'active',
  })
  status: string;

  @ApiProperty({
    description: 'File context ID',
    example: 'product-image',
  })
  contextId: string;

  @ApiProperty({
    description: 'Whether the file is publicly accessible',
    example: true,
  })
  isPublic: boolean;

  @ApiProperty({
    description: 'Additional metadata',
    required: false,
    example: { width: 1920, height: 1080 },
  })
  metadata?: Record<string, any> | null;

  @ApiProperty({
    description: 'Creation timestamp',
    example: '2025-01-15T10:00:00Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Activation timestamp',
    example: '2025-01-15T10:05:00Z',
    required: false,
  })
  activatedAt?: Date | null;
}

