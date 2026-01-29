import { ApiProperty } from '@nestjs/swagger';
import { AddressDto } from '../../../commons/dto/address.dto';

export class ShopInfoDto {
  @ApiProperty({ description: '상점 ID' })
  id: string;

  @ApiProperty({ description: '사용자 ID' })
  userId: string;

  @ApiProperty({ description: '운영 여부' })
  isOperating: boolean;

  @ApiProperty({ description: '운영 연수', nullable: true })
  yearsOperating: number | null;

  @ApiProperty({ description: '상점 유형', enum: ['solo', 'small', 'large'] })
  shopType?: 'solo' | 'small' | 'large' | null;

  @ApiProperty({ description: '카테고리 정보' })
  categories: unknown;

  @ApiProperty({ description: '타겟 고객 정보', nullable: true })
  targetCustomers: unknown;

  @ApiProperty({ description: '영업일 정보', nullable: true })
  openDays: unknown;

  @ApiProperty({ description: '상점 생성일' })
  createdAt: Date;

  @ApiProperty({ description: '상점 수정일' })
  updatedAt: Date;
}

export class ProfileDto {
  @ApiProperty({ description: '프로필 ID' })
  id: string;

  @ApiProperty({ description: '사용자 ID' })
  userId: string;

  @ApiProperty({ description: '전화번호', nullable: true })
  phoneNumber: string | null;

  @ApiProperty({ description: '주소 정보', type: AddressDto, nullable: true })
  address: AddressDto | null;

  @ApiProperty({ description: '생년월일', nullable: true })
  birthDate: Date | null;

  @ApiProperty({ description: '프로필 이미지 URL', nullable: true })
  profileImageUrl: string | null;

  @ApiProperty({ description: '프로필 생성일' })
  createdAt: Date;

  @ApiProperty({ description: '프로필 수정일' })
  updatedAt: Date;
}

export class UserDetailsResponseDto {
  @ApiProperty({ description: '사용자 ID' })
  id: string;

  @ApiProperty({ description: '로그인 ID' })
  loginId: string;

  @ApiProperty({ description: '사용자 이름' })
  username: string;

  @ApiProperty({ description: '사용자 닉네임', nullable: true })
  nickname: string | null;

  @ApiProperty({ description: '이메일' })
  email: string;

  @ApiProperty({ description: '이메일 인증 여부' })
  isEmailVerified: boolean;

  @ApiProperty({ description: '마지막 활동 시간' })
  lastActivityAt: Date;

  @ApiProperty({ description: '생성일' })
  createdAt: Date;

  @ApiProperty({ description: '수정일' })
  updatedAt: Date;

  @ApiProperty({ description: '상점 정보', type: ShopInfoDto, nullable: true })
  shop: ShopInfoDto | null;

  @ApiProperty({ description: '프로필 정보', type: ProfileDto, nullable: true })
  profile: ProfileDto | null;
}
