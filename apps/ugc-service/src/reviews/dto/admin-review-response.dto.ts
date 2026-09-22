import { ApiProperty } from '@nestjs/swagger';
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
}
