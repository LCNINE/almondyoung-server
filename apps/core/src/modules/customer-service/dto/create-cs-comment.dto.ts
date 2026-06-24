import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';

export class CsCommentAttachmentInput {
  @ApiProperty({ description: 'file-service 파일 ID' })
  @IsString()
  @MaxLength(255)
  fileId: string;

  @ApiProperty({ description: '파일명', required: false })
  @IsString()
  @MaxLength(255)
  @IsOptional()
  fileName?: string;
}

export class CreateCsCommentDto {
  @ApiProperty({ description: '댓글 본문' })
  @IsString()
  body: string;

  @ApiProperty({ description: '멘션할 사용자 ID 목록', required: false, type: [String] })
  @IsArray()
  @IsUUID('all', { each: true })
  @IsOptional()
  mentionedUserIds?: string[];

  @ApiProperty({ description: '첨부 목록', required: false, type: [CsCommentAttachmentInput] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CsCommentAttachmentInput)
  @IsOptional()
  attachments?: CsCommentAttachmentInput[];
}
