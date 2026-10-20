import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AttachReferencePhotoDto {
  @ApiProperty({ description: 'file-service 에 올린 사진의 파일 ID' })
  @IsUUID()
  fileId!: string;
}
