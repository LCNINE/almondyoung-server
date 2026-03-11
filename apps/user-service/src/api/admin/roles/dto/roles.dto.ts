import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateRoleDto {
  @ApiProperty({ description: '역할 이름', example: 'manager' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: '역할 설명', example: '매니저 역할', required: false })
  @IsString()
  @IsOptional()
  description?: string;
}

export class UpdateRoleDto {
  @ApiProperty({ description: '역할 이름', example: 'manager', required: false })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({ description: '역할 설명', example: '매니저 역할', required: false })
  @IsString()
  @IsOptional()
  description?: string;
}

export class RoleResponseDto {
  roleId: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}
