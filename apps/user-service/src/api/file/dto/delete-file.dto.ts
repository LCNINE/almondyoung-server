import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class DeleteFileDto {
  @ApiProperty({
    description: 'AWS S3의 폴더명 (예: avatar, profile, post)',
    example: 'avatar',
  })
  @IsString()
  folderName: string;

  @ApiProperty({
    description: 'AWS S3의 파일명 (예: filename.jpg)',
    example: 'filename.jpg',
  })
  @IsString()
  fileName: string;
}
