import { ApiProperty } from '@nestjs/swagger';

class RoleDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;
}

export class UserRoleResponseDto {
  @ApiProperty({ type: RoleDto, nullable: true })
  role: RoleDto | null;
}

export class UserRolesResponse {
  @ApiProperty()
  userId: string;

  @ApiProperty({ type: [UserRoleResponseDto] })
  roles: UserRoleResponseDto[];
}
