import { TENANT_ID_PATTERN } from '@app/tenancy';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class AssignmentDto {
  @ApiProperty() roleId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty({ enum: ['staff', 'customer'] }) audience!: 'staff' | 'customer';
  @ApiProperty() isSystem!: boolean;
  @ApiProperty() assignedAt!: Date;
  @ApiProperty({ nullable: true, type: Date }) expiresAt!: Date | null;
  @ApiProperty({ description: '종료일이 지났다(토큰 발급 때 빠진다)' }) expired!: boolean;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class UserRolesResponseDto {
  @ApiProperty({ type: [AssignmentDto] }) roles!: AssignmentDto[];
}

export class ReplaceUserRolesDto {
  @ApiProperty({ type: [String], description: '사용자에게 남길 역할 ID 전부(고객 역할 포함)' })
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  roleIds!: string[];
}

export class StaffAssignmentInputDto {
  @ApiProperty() @IsUUID() roleId!: string;
  @ApiProperty({
    nullable: true,
    type: String,
    example: '2026-12-31',
    description: '이날까지(한국 시각). null 이면 무기한',
  })
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @Matches(DATE_ONLY)
  expiresAt!: string | null;
}

export class ReplaceStaffRolesDto {
  @ApiProperty({ type: [StaffAssignmentInputDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => StaffAssignmentInputDto)
  assignments!: StaffAssignmentInputDto[];
}

export class AddRoleMembersDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) userIds!: string[];
  @ApiProperty({
    nullable: true,
    type: String,
    example: '2026-12-31',
    description: '이날까지(한국 시각). null 이면 무기한',
  })
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @Matches(DATE_ONLY)
  expiresAt!: string | null;
  @ApiPropertyOptional({ description: '이 테넌트에서 준다(받는 사람은 그 테넌트 소속이어야 한다). 플랫폼 운영자만' })
  @IsOptional()
  @Matches(TENANT_ID_PATTERN)
  tenantId?: string;
}

export class RoleMemberDto {
  @ApiProperty() userId!: string;
  @ApiProperty() loginId!: string;
  @ApiProperty() username!: string;
  @ApiProperty() assignedAt!: Date;
  @ApiProperty({ nullable: true, type: Date }) expiresAt!: Date | null;
  @ApiProperty() expired!: boolean;
  @ApiProperty({ description: '탈퇴·휴면이 아니다(마지막 시스템 역할 보유자 판정에 쓴다)' }) canSignIn!: boolean;
}
