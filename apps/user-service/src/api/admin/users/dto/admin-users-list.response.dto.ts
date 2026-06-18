import { ApiProperty } from '@nestjs/swagger';

export class AdminUserListItemDto {
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

  @ApiProperty({ nullable: true })
  phoneNumber: string | null;

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
}

export class AdminUsersListResponseDto {
  @ApiProperty({ type: [AdminUserListItemDto] })
  data: AdminUserListItemDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;
}
