import { ApiProperty } from '@nestjs/swagger';

class RoleDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;
}

class ScopeDto {
  @ApiProperty()
  scope_name: string;

  @ApiProperty()
  description: string;
}

export class UserRoleScopesResponseDto {
  @ApiProperty({ type: RoleDto, nullable: true })
  role: RoleDto | null;

  @ApiProperty({ type: ScopeDto, nullable: true })
  scopes: ScopeDto | null;
}

export class UserRolesResponse {
  @ApiProperty()
  userId: string;

  @ApiProperty({ type: [UserRoleScopesResponseDto] })
  roles: UserRoleScopesResponseDto[];
}
