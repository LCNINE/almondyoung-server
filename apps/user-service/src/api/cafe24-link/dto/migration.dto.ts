import { ApiProperty } from '@nestjs/swagger';

export class Cafe24MigrationItemDto {
  @ApiProperty({
    description: '이관 항목 키',
    example: 'email',
  })
  key: string;

  @ApiProperty({
    description: '이관 상태',
    example: 'synced',
  })
  status: 'synced' | 'out_of_sync' | 'missing';

  @ApiProperty({
    description: 'Cafe24 값',
    example: 'user@example.com',
    nullable: true,
  })
  cafe24Value: string | null;

  @ApiProperty({
    description: '현재 사용자 값',
    example: 'user@example.com',
    nullable: true,
  })
  userValue: string | null;
}

export class Cafe24MigrationListResponseDto {
  @ApiProperty({ type: [Cafe24MigrationItemDto] })
  items: Cafe24MigrationItemDto[];
}
