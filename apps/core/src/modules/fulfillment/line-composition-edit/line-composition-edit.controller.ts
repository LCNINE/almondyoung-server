import { Body, Controller, Param, ParseUUIDPipe, Put, UnauthorizedException } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { User } from '@app/authorization';
import { LineCompositionChangeResponseDto, PutLineCompositionDto } from './line-composition-edit.dto';
import { LineCompositionEditService } from './line-composition-edit.service';

type AuthenticatedUser = { userId?: string; id?: string; sub?: string };

function actorOf(user: AuthenticatedUser | undefined): { id: string } {
  const id = user?.userId ?? user?.id ?? user?.sub;
  if (!id) throw new UnauthorizedException('Authenticated actor is required');
  return { id };
}

// 판매주문 경로지만 박스를 바꾸므로 fulfillment 모듈에 둔다 — sales-order 모듈은 fulfillment 를 import 하지 못한다(순환)
@ApiTags('Sales Orders')
@Controller('sales-orders')
export class SalesOrderLineCompositionController {
  constructor(private readonly edits: LineCompositionEditService) {}

  @Put(':id/lines/:lineId/composition')
  @ApiOperation({
    summary:
      '판매주문 라인 하나의 SKU 구성 지정(이 주문만) — FO 전이면 매칭 대기를 풀고, FO 뒤면 작성 중 박스를 맞춘다',
  })
  @ApiOkResponse({ type: LineCompositionChangeResponseDto })
  assign(
    @Param('id', ParseUUIDPipe) salesOrderId: string,
    @Param('lineId', ParseUUIDPipe) salesOrderLineId: string,
    @Body() dto: PutLineCompositionDto,
    @User() user?: AuthenticatedUser,
  ) {
    return this.edits.assignToLine(salesOrderId, salesOrderLineId, dto, actorOf(user));
  }
}
