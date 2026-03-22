import { ApiProperty } from '@nestjs/swagger';

export class ScopeResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() key: string;
  @ApiProperty({ nullable: true }) category: string | null;
  @ApiProperty({ nullable: true }) description: string | null;
  @ApiProperty() microserviceName: string;
  @ApiProperty() createdAt: Date;
}

export class ScopeListResponseDto {
  @ApiProperty({ type: [ScopeResponseDto] })
  scopes: ScopeResponseDto[];

  @ApiProperty()
  total: number;
}

export class RoleScopesResponseDto {
  @ApiProperty() roleName: string;
  @ApiProperty({ type: [String] }) scopes: string[];
}
