import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, ValidateIf } from 'class-validator';

export class AssignCsCaseDto {
  @ApiProperty({ description: '담당자 ID. null이면 배정 해제', nullable: true })
  @ValidateIf((o: { assigneeId?: string | null }) => o.assigneeId !== null)
  @IsUUID()
  assigneeId: string | null;
}
