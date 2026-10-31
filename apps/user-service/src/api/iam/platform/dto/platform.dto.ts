import { TENANT_ID_PATTERN, TENANT_SLUG_PATTERN } from '@app/tenancy';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { IsRedirectUri } from '../../../oauth/redirect-uri';

/** URL 의 host(포트 포함). 대소문자는 저장할 때 소문자로 맞춘다. */
const HOST = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*(?::\d{1,5})?$/;

export class TenantDto {
  @ApiProperty() id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ enum: ['preparing', 'active', 'suspended'] }) status!: 'preparing' | 'active' | 'suspended';
  @ApiProperty() displayName!: string;
  @ApiProperty({ nullable: true, type: String }) logoUrl!: string | null;
  @ApiProperty({ type: [String], description: '테넌트 도메인(host)' }) domains!: string[];
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
}

export class CreateTenantDto {
  @ApiProperty({ description: '테넌트 목록(TENANT_LIST)의 id 와 같은 값', example: '2' })
  @Matches(TENANT_ID_PATTERN)
  id!: string;
  @ApiProperty({ description: '테넌트 목록의 slug 와 같은 값' }) @Matches(TENANT_SLUG_PATTERN) slug!: string;
  @ApiProperty({ description: '로그인·관리자 화면에 보이는 이름' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  displayName!: string;
  @ApiPropertyOptional({ description: '로고 주소(https)' })
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(1000)
  logoUrl?: string;
  @ApiProperty({ type: [String], description: '테넌트 도메인(host, 포트 포함). 1개 이상' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @Matches(HOST, { each: true })
  @MaxLength(255, { each: true })
  domains!: string[];
}

export class SetTenantStatusDto {
  @ApiProperty({ enum: ['active', 'suspended'], description: '준비 → 활성 ↔ 정지' })
  @IsIn(['active', 'suspended'])
  status!: 'active' | 'suspended';
}

export class AddTenantMemberDto {
  @ApiProperty() @IsUUID() userId!: string;
}

export class AddStaffClientUrisDto {
  @ApiProperty({ type: [String], description: '이 테넌트 도메인의 로그인 리디렉트 주소' })
  @IsArray()
  @ArrayMaxSize(20)
  @IsRedirectUri({ each: true })
  redirectUris!: string[];
  @ApiProperty({ type: [String], description: '이 테넌트 도메인의 로그아웃 뒤 주소' })
  @IsArray()
  @ArrayMaxSize(20)
  @IsRedirectUri({ each: true })
  postLogoutRedirectUris!: string[];
}

export class ReissuePasswordDto {
  @ApiPropertyOptional({ description: '첫 로그인 때 변경 강제(기본 true). false 는 점검 계정용' })
  @IsOptional()
  @IsBoolean()
  forcePasswordChange?: boolean;
}

export class ReissuedPasswordDto {
  @ApiProperty({ description: '한 번만 나간다 — 서버에 원문이 남지 않는다' }) initialPassword!: string;
}

export class SetPlatformOperatorDto {
  @ApiProperty() @IsBoolean() isOperator!: boolean;
}

export class TenantBrandQueryDto {
  @ApiProperty({ description: '요청이 들어온 주소의 host(포트 포함)' })
  @Matches(HOST)
  @MaxLength(255)
  host!: string;
}

export class TenantBrandDto {
  @ApiProperty() displayName!: string;
  @ApiProperty({ nullable: true, type: String }) logoUrl!: string | null;
  @ApiProperty({ description: '활성 테넌트인가(아니면 로그인할 수 없다)' }) active!: boolean;
}
