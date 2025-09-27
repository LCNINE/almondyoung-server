import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SetUserRoleDto {
  @ApiProperty({
    description: '사용자 ID',
    example: 'user-123',
  })
  @IsString({ message: 'userId는 문자열이어야 합니다.' })
  @IsNotEmpty({ message: 'userId는 필수입니다.' })
  userId: string;

  @ApiProperty({
    description: '역할 ID',
    example: 'role-123',
  })
  @IsString({ message: 'roleId는 문자열이어야 합니다.' })
  @IsNotEmpty({ message: '연결할 roleId를 입력해주세요.' })
  roleId: string;

  @ApiProperty({
    description: '만료 일시',
    example: '2025-08-28T06:37:21.019641',
    type: String,
    required: false,
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: '만료일은 유효한 날짜여야 합니다.' })
  expires_at?: Date;
}
