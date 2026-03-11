import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsUUID } from 'class-validator';

export class ReplaceUserRolesDto {
  @ApiProperty({
    description: '사용자에게 할당할 역할 ID 배열',
    example: ['uuid-1', 'uuid-2'],
    type: [String],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  roleIds: string[];
}

export class UserRolesResponseDto {
  roleIds: string[];
}
