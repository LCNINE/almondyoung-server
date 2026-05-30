import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { type CsCasePriority } from '../schema/customer-service.schema';

export class CreateCsCaseDto {
  @ApiProperty({ description: 'CS Case 제목' })
  @IsString()
  @MaxLength(255)
  subject: string;

  @ApiProperty({ description: '상담/처리 사유 코드', required: false })
  @IsString()
  @MaxLength(96)
  @IsOptional()
  reasonCode?: string;

  @ApiProperty({ description: '상세 설명', required: false })
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

  @ApiProperty({ description: '고객 ID', required: false })
  @IsUUID()
  @IsOptional()
  customerId?: string;

  @ApiProperty({ description: '고객명', required: false })
  @IsString()
  @MaxLength(255)
  @IsOptional()
  customerName?: string;

  @ApiProperty({ description: '고객 이메일', required: false })
  @IsString()
  @MaxLength(255)
  @IsOptional()
  customerEmail?: string;

  @ApiProperty({ description: '고객 전화번호', required: false })
  @IsString()
  @MaxLength(64)
  @IsOptional()
  customerPhone?: string;

  @ApiProperty({ description: '담당자 ID', required: false })
  @IsUUID()
  @IsOptional()
  assignedTo?: string;

  @ApiProperty({ description: '표시/추적용 부가 정보', required: false })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}
