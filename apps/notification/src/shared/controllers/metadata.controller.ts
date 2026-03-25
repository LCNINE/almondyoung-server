// apps/notification/src/shared/controllers/metadata.controller.ts
import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

// 스키마에 정의된 알림 카테고리 목록 (notification-schema.ts의 notificationCategoryEnum과 동기화)
const NOTIFICATION_CATEGORIES = [
  'INFORMATIONAL', // 정보성 알림 (동의 없이 발송 가능)
  'MARKETING', // 마케팅/프로모션 (동의 필요)
  'TRANSACTIONAL', // 거래 관련 (주문, 결제 등)
  'SYSTEM', // 시스템 알림 (비밀번호 변경 등)
  'ADMIN', // 관리자 알림
  'OPERATIONAL', // 운영 알림 (점검 등)
  'CUSTOMER_SERVICE', // 고객 서비스 (문의 답변 등)
] as const;

@ApiTags('metadata')
@Controller('metadata')
export class MetadataController {
  @Get('notification-categories')
  @ApiOperation({
    summary: '알림 카테고리 목록 조회',
    description: '시스템에서 사용 가능한 모든 알림 카테고리 이넘 값을 조회합니다.',
  })
  @ApiResponse({
    status: 200,
    description: '알림 카테고리 목록 조회 성공',
    schema: {
      type: 'object',
      properties: {
        categories: {
          type: 'array',
          items: {
            type: 'string',
            enum: NOTIFICATION_CATEGORIES as unknown as string[],
          },
        },
      },
    },
  })
  getNotificationCategories() {
    return {
      categories: NOTIFICATION_CATEGORIES,
    };
  }
}
