import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const LANDING_PATH = /^\/[a-z0-9\-/]*$/;

export class RoleSummaryDto {
  @ApiProperty() roleId!: string;
  @ApiProperty({ description: '토큰에 실리는 역할 ID(만든 뒤 바꾸지 않는다)' }) name!: string;
  @ApiProperty({ description: '화면 표시 이름. 없으면 name' }) displayName!: string;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty({ enum: ['staff', 'customer'] }) audience!: 'staff' | 'customer';
  @ApiProperty({ description: '시스템 역할(편집·삭제 불가)' }) isSystem!: boolean;
  @ApiProperty({ description: '동시 편집 감지용 버전' }) version!: number;
  @ApiProperty({ nullable: true, type: String, description: '로그인 첫 화면' }) landingPath!: string | null;
  @ApiProperty({ description: '지금 이 역할을 가진 사람 수(기간이 지난 부여 제외)' }) memberCount!: number;
  @ApiProperty() permissionCount!: number;
  @ApiProperty() dangerousCount!: number;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class RoleDetailDto extends RoleSummaryDto {
  @ApiProperty({ type: [String], description: '이 역할의 권한(시스템 역할은 활성 권한 전체를 계산한 값)' })
  permissions!: string[];
  @ApiProperty({ type: [String], description: '이 역할이 가진 폐기된 권한(새로 켤 수 없고 끌 수만 있다)' })
  deprecatedPermissions!: string[];
}

export class CreateRoleDto {
  @ApiProperty({ example: 'cs_team' }) @IsString() @IsNotEmpty() name!: string;
  @ApiProperty({ example: 'CS 팀' }) @IsString() @IsNotEmpty() @MaxLength(100) displayName!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional({ example: '/cs' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(LANDING_PATH)
  landingPath?: string;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  permissions?: string[];
  @ApiPropertyOptional({ description: '이 역할의 지금 권한을 그대로 복사해서 시작' })
  @IsOptional()
  @IsUUID()
  copyFromRoleId?: string;
}

export class UpdateRoleDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) displayName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional({ nullable: true, type: String })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(200)
  @Matches(LANDING_PATH)
  landingPath?: string | null;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) version!: number;
}

export class ReplaceRolePermissionsDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) permissions!: string[];
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) version!: number;
}

export class DeleteRoleQueryDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) version!: number;
}
