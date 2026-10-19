import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { IAM_AUDIT_ACTIONS, type IamAuditAction } from '../iam-audit.creator';

export class IamAuditLogsQueryDto {
  @ApiPropertyOptional({ description: '이 시각 이후(포함)' }) @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional({ description: '이 시각 이전(제외)' }) @IsOptional() @IsISO8601() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() actorUserId?: string;
  @ApiPropertyOptional({ enum: ['role', 'user', 'pii_access_log'] })
  @IsOptional()
  @IsIn(['role', 'user', 'pii_access_log'])
  targetType?: 'role' | 'user' | 'pii_access_log';
  @ApiPropertyOptional() @IsOptional() @IsUUID() targetId?: string;
  @ApiPropertyOptional({ description: '이 역할의 변경과 이 역할이 들어가거나 빠진 부여 변경' })
  @IsOptional()
  @IsUUID()
  roleId?: string;
  @ApiPropertyOptional({ enum: IAM_AUDIT_ACTIONS }) @IsOptional() @IsIn([...IAM_AUDIT_ACTIONS]) action?: IamAuditAction;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) cursor?: string;
  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class IamAuditLogDto {
  @ApiProperty() id!: string;
  @ApiProperty() occurredAt!: Date;
  @ApiProperty() actorUserId!: string;
  @ApiProperty({ nullable: true, type: String }) actorLoginId!: string | null;
  @ApiProperty({ enum: IAM_AUDIT_ACTIONS }) action!: string;
  @ApiProperty({ enum: ['role', 'user', 'pii_access_log'] }) targetType!: string;
  @ApiProperty() targetId!: string;
  @ApiProperty({ description: '그 시점의 대상 이름' }) targetLabel!: string;
  @ApiProperty({ description: '변경 전(JSON)' }) before!: unknown;
  @ApiProperty({ description: '변경 후(JSON)' }) after!: unknown;
  @ApiProperty({ nullable: true, type: String, description: '요청자 주소(관리자 화면 프록시가 넘긴 값)' }) ip!: string | null;
  @ApiProperty({ nullable: true, type: String }) userAgent!: string | null;
  @ApiProperty({ nullable: true, type: String }) requestId!: string | null;
}

export class IamAuditPageDto {
  @ApiProperty({ type: [IamAuditLogDto] }) items!: IamAuditLogDto[];
  @ApiProperty({ nullable: true, type: String, description: '다음 페이지(없으면 null)' }) nextCursor!: string | null;
}
