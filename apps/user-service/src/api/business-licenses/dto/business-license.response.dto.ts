import { ApiProperty } from '@nestjs/swagger';

export class BusinessLicenseResponseDto {
  @ApiProperty({
    description: '사업자 등록 정보 ID',
    type: String,
  })
  id: string;

  @ApiProperty({
    description: '사용자 ID',
    type: String,
  })
  userId: string;

  @ApiProperty({
    description: '상점 ID',
    type: String,
    nullable: true,
  })
  shopId?: string;

  @ApiProperty({
    description: '사업자 등록 번호 (10자리)',
    type: String,
    nullable: true,
  })
  businessNumber?: string;

  @ApiProperty({
    description: '대표자 이름',
    type: String,
    nullable: true,
  })
  representativeName?: string;

  @ApiProperty({
    description: '검토 상태',
    enum: ['under_review', 'approved', 'rejected'],
  })
  status: 'under_review' | 'approved' | 'rejected';

  @ApiProperty({
    description: '검토 코멘트',
    type: String,
    nullable: true,
  })
  reviewComment?: string;

  @ApiProperty({
    description: '검토 일시',
    type: Date,
    nullable: true,
  })
  reviewedAt?: Date;

  @ApiProperty({
    description: '인증 완료 일시',
    type: Date,
    nullable: true,
  })
  verifiedAt?: Date;

  @ApiProperty({
    description: '증빙 검증 파일 URL',
    type: String,
    nullable: true,
  })
  verificationFile?: string;

  @ApiProperty({
    description: '추가 메타데이터',
    type: 'object',
    nullable: true,
    additionalProperties: true,
  })
  metadata?: string;

  @ApiProperty({
    description: '생성 일시',
    type: Date,
  })
  createdAt: Date;

  @ApiProperty({
    description: '수정 일시',
    type: Date,
  })
  updatedAt: Date;
}
