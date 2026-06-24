import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { type CsCasePriority, type CsCaseSourceChannel } from '../schema/customer-service.schema';

export class CreateCsCaseDto {
  @ApiProperty({ description: 'CS Case 제목' })
  @IsString()
  @MaxLength(255)
  subject: string;

  @ApiProperty({ description: '상세 설명(카톡 내용 복사/요약)', required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    description: '우선순위',
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal',
    required: false,
  })
  @IsIn(['low', 'normal', 'high', 'urgent'])
  @IsOptional()
  priority?: CsCasePriority;

  @ApiProperty({
    description: '유입 채널',
    enum: ['kakao', 'web_messenger', 'manual'],
    default: 'kakao',
    required: false,
  })
  @IsIn(['kakao', 'web_messenger', 'manual'])
  @IsOptional()
  sourceChannel?: CsCaseSourceChannel;

  @ApiProperty({ description: '외부 대화 포인터(카톡 상담방/닉네임 등)', required: false })
  @IsString()
  @MaxLength(255)
  @IsOptional()
  externalThreadRef?: string;

  @ApiProperty({ description: '고객 ID(회원 특정 시에만)', required: false })
  @IsUUID()
  @IsOptional()
  customerId?: string;

  @ApiProperty({ description: '고객명', required: false })
  @IsString()
  @MaxLength(255)
  @IsOptional()
  customerName?: string;

  @ApiProperty({ description: '담당자 ID', required: false })
  @IsUUID()
  @IsOptional()
  assignedTo?: string;

  @ApiProperty({ description: '표시/추적용 부가 정보', required: false })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}
