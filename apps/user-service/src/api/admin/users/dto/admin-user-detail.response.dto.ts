import { ApiProperty } from '@nestjs/swagger';
import {
  ProfileDto,
  ShopInfoDto,
} from '../../../users/dto/user-details.response.dto';

export class AdminUserDetailResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  loginId: string;

  @ApiProperty()
  username: string;

  @ApiProperty({ nullable: true })
  nickname: string | null;

  @ApiProperty()
  email: string;

  @ApiProperty()
  isEmailVerified: boolean;

  @ApiProperty({ nullable: true })
  lastActivityAt: Date | null;

  @ApiProperty({ nullable: true })
  deletedAt: Date | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ type: [String] })
  roles: string[];

  @ApiProperty({ type: ShopInfoDto, nullable: true })
  shop: ShopInfoDto | null;

  @ApiProperty({ type: ProfileDto, nullable: true })
  profile: ProfileDto | null;
}
