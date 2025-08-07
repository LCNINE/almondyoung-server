import { IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetUserScopesDto {
  @ApiProperty({
    description: '권한 범위',
    example: 'read:users,write:users',
  })
  @IsString({ message: '스코프는 문자열이어야 합니다.' })
  scopes: string;

  @ApiProperty({
    description: '권한 범위 설명',
    example: '사용자 읽기/쓰기 권한',
  })
  @IsString({ message: '설명은 문자열이어야 합니다.' })
  description: string;
}
