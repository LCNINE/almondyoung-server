import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsUUID, ValidateIf } from 'class-validator';

export class AssignCsCaseDto {
  @ApiProperty({ description: '담당자 ID. null이면 배정 해제', nullable: true })
  @ValidateIf((o) => o.assigneeId !== null)
  @IsUUID()
  @IsOptional()
  assigneeId: string | null;
}
