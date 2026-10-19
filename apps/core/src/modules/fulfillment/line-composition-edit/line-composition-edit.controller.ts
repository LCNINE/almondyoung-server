import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, UnauthorizedException } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission, User } from '@app/authorization';
import {
  ApplyToExistingLinesResponseDto,
  ExistingLinesImpactResponseDto,
  LineCompositionChangeResponseDto,
  PutLineCompositionDto,
} from './line-composition-edit.dto';
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

  @RequirePermission('order.matching.write')
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

// 상품매칭 저장 다이얼로그가 부른다. ProductMatchingModule 은 fulfillment 를 import 하지 못해(순환) 여기 둔다
@ApiTags('Product Matching')
@Controller('matchings')
export class MatchingExistingLinesController {
  constructor(private readonly edits: LineCompositionEditService) {}

  @RequirePermission('order.order.read')
  @Get('variants/:variantId/existing-lines-impact')
  @ApiOperation({ summary: '상품매칭 변경이 이미 굳힌 출고 라인에 미칠 영향(미리보기)' })
  @ApiOkResponse({ type: ExistingLinesImpactResponseDto })
  impact(@Param('variantId', ParseUUIDPipe) variantId: string) {
    return this.edits.previewExistingLines(variantId);
  }

  @RequirePermission('order.matching.write')
  @Post('variants/:variantId/apply-to-existing-lines')
  @ApiOperation({ summary: '상품매칭을 기존 출고(작성 중 박스)에도 적용 — 개별 지정·작업 중 박스는 건너뛴다' })
  @ApiOkResponse({ type: ApplyToExistingLinesResponseDto })
  apply(@Param('variantId', ParseUUIDPipe) variantId: string, @User() user?: AuthenticatedUser) {
    return this.edits.applyToExistingLines(variantId, actorOf(user));
  }
}
