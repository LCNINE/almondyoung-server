import { ApiProperty } from '@nestjs/swagger';
import { ADMIN_MANUAL_SOURCE_SYSTEM } from '../../source-system';
import { ReviewResponseDto } from './review-response.dto';

export class AdminReviewPermissionDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: ['order', 'admin'] }) provider: 'order' | 'admin';
  @ApiProperty({ nullable: true }) batchId: string | null;
  @ApiProperty({ nullable: true }) grantedReason: string | null;
}

export class AdminReviewResponseDto extends ReviewResponseDto {
  @ApiProperty({ type: AdminReviewPermissionDto, nullable: true })
  permission: AdminReviewPermissionDto | null;

  @ApiProperty({
    description: '출처. almondyoung=자체 작성, admin-manual=관리자 수기 작성, 그 밖=다른 사이트 이관',
    example: ADMIN_MANUAL_SOURCE_SYSTEM,
  })
  sourceSystem: string;

  @ApiProperty({ description: '관리자 수기 작성분의 입력자 ID. 그 밖은 null', nullable: true })
  createdByAdminUserId: string | null;
}
