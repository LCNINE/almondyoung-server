import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@app/authorization';
import { TenantFree } from '../../../platform/tenancy/tenant-free.decorator';
import { PrintOrderTrackingManager } from '../services/print-order-tracking.manager';

const ORDNUM = /^[A-Za-z0-9_-]{1,40}$/;

// 와우프레스 주문상태 CALL BACK(API 문서 6.11). 테넌트 헤더를 못 보내므로 TenantFree 이고, 행은 모든 테넌트 DB 에서 찾는다
@ApiTags('WowPress Callback')
@Controller('wowpress/callback')
export class WowpressCallbackController {
  constructor(private readonly tracking: PrintOrderTrackingManager) {}

  @Public()
  @TenantFree()
  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: '와우프레스 주문상태 변경 통보. 본문은 주문번호만 쓰고 상태는 주문상세로 다시 읽는다' })
  async receive(@Body() body: Record<string, unknown>): Promise<{ ok: true }> {
    const ordnum = body?.ordnum;
    if (typeof ordnum === 'string' && ORDNUM.test(ordnum)) {
      await this.tracking.refreshByVendorOrderNumber(ordnum);
    }

    return { ok: true };
  }
}
