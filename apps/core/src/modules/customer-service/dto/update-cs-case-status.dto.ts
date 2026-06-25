import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { type CsCaseStatus } from '../schema/customer-service.schema';

export class UpdateCsCaseStatusDto {
  @ApiProperty({ description: '새 상태', enum: ['open', 'pending', 'closed'] })
  @IsIn(['open', 'pending', 'closed'])
  status: CsCaseStatus;
}
