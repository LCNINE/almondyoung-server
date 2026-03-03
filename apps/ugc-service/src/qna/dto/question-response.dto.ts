import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AnswerResponseDto } from './answer-response.dto';

export class QuestionResponseDto {
  @ApiProperty({ description: '질문 ID' })
  id: string;

  @ApiProperty({ description: '작성자 사용자 ID' })
  userId: string;

  @ApiProperty({ description: '작성자 닉네임', example: '홍길동' })
  nickname: string;

  @ApiProperty({ description: '상품 ID' })
  productId: string;

  @ApiProperty({ description: '질문 제목' })
  title: string;

  @ApiProperty({ description: '질문 내용' })
  content: string;

  @ApiProperty({ description: '비밀글 여부' })
  isSecret: boolean;

  @ApiProperty({ description: '상태', example: 'active' })
  status: string;

  @ApiProperty({ description: '첨부 미디어 파일 ID 목록', type: [String] })
  mediaFileIds: string[];

  @ApiPropertyOptional({
    description: '관리자 답변',
    type: AnswerResponseDto,
    nullable: true,
  })
  answer: AnswerResponseDto | null;

  @ApiProperty({ description: '생성일시 (ISO 8601)', example: '2025-12-05T10:30:00.000Z' })
  createdAt: string;

  @ApiProperty({ description: '수정일시 (ISO 8601)', example: '2025-12-05T10:30:00.000Z' })
  updatedAt: string;
}
