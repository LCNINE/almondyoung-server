import { ApiProperty } from '@nestjs/swagger';

import { User } from '../../../../database/drizzle/schema';

export class UserResponseDto implements Partial<User> {
  @ApiProperty()
  id: string;

  @ApiProperty()
  loginId: string;

  @ApiProperty()
  username: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  isEmailVerified: boolean;

  @ApiProperty()
  lastActivityAt: Date;

  @ApiProperty({ nullable: true })
  deletedAt: Date | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ type: [String] })
  roles: string[];
}
