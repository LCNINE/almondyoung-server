import { IsString, MinLength, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetRoleDto {
  @ApiProperty({
    description: '사용자 ID',
    example: 'user-123',
  })
  @IsString({ message: 'userId는 문자열이어야 합니다.' })
  @IsNotEmpty({ message: 'userId는 필수입니다.' })
  userId: string;

  @ApiProperty({
    description: '역할 이름',
    example: 'admin',
  })
  @IsString({ message: 'role는 문자열이어야 합니다.' })
  @IsNotEmpty({ message: 'role은 필수입니다.' })
  role: string;

  @ApiProperty({
    description: '역할 설명',
    example: '시스템 관리자 권한',
  })
  @IsString({ message: 'description는 문자열이어야 합니다.' })
  @MinLength(1, { message: '룰 설명은 최소 1자 이상이어야 합니다.' })
  @IsNotEmpty({ message: '룰 설명은 필수입니다.' })
  description: string;
}

export class AssignUserRoleDto {
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
  @IsNotEmpty({ message: 'roleId는 필수입니다.' })
  roleId: string;
}
