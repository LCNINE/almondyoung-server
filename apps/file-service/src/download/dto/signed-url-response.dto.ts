import { ApiProperty } from '@nestjs/swagger';

export class SignedUrlResponseDto {
  @ApiProperty({
    description: 'Signed URL for file download',
    example: 'https://bucket.s3.amazonaws.com/path/to/file.jpg?signature=...',
  })
  signedUrl: string;

  @ApiProperty({
    description: 'Expiration timestamp',
    example: '2025-01-15T12:00:00Z',
  })
  expiresAt: Date;
}

