import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class Cafe24MemberInfoRequestDto {
  @ApiProperty({
    description: 'Cafe24 front SDK에서 받은 암호화 id 토큰',
    example: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiJ9...',
  })
  @IsString({ message: '암호화 id 토큰은 문자열이어야 합니다.' })
  encryptedIdToken: string;
}

export class Cafe24MemberInfoResponseDto {
  @ApiProperty({
    description: 'Cafe24 회원 ID',
    example: 'member123',
  })
  memberId: string;

  @ApiProperty({
    description: 'Cafe24 회원 이름',
    example: '홍길동',
    nullable: true,
  })
  memberName: string | null;
}
