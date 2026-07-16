import {
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UnauthorizedException,
  UseGuards,
  Body,
} from '@nestjs/common';
import { RequireScopes, ScopeGuard, User } from '@app/authorization';
import { ApiAcceptedResponse, ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import {
  InvoiceOperationResponseDto,
  IssueManualInvoiceDto,
  IssueShipmentInvoiceDto,
  ManualInvoiceResponseDto,
  ShipmentInvoiceActor,
  VoidManualInvoiceDto,
  VoidShipmentInvoiceDto,
} from '../dto/shipment-invoice.dto';
import { InvoiceOrchestrator } from '../services/invoice-orchestrator.service';

type AuthenticatedUser = { id?: string; userId?: string; sub?: string; roles?: string[] };

@Controller()
@UseGuards(ScopeGuard)
export class ShipmentInvoiceController {
  constructor(private readonly invoices: InvoiceOrchestrator) {}

  @Post('shipments/:shipmentId/invoices')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiAcceptedResponse({ type: InvoiceOperationResponseDto })
  issue(
    @Param('shipmentId') shipmentId: string,
    @Body() dto: IssueShipmentInvoiceDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.invoices.issueForShipment(shipmentId, dto, idempotencyKey ?? '', this.actor(user));
  }

  @Post('invoices/:invoiceId/void')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireScopes(FULFILLMENT_SCOPE.SHIPMENT_REOPEN)
  @ApiAcceptedResponse({ type: InvoiceOperationResponseDto })
  void(
    @Param('invoiceId') invoiceId: string,
    @Body() dto: VoidShipmentInvoiceDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.invoices.void(invoiceId, dto, idempotencyKey ?? '', this.actor(user));
  }

  @Get('invoice-operations/:operationId')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiOkResponse({ type: InvoiceOperationResponseDto })
  operation(@Param('operationId') operationId: string) {
    return this.invoices.getOperation(operationId);
  }

  @Post('shipments/:shipmentId/invoices/manual')
  @HttpCode(HttpStatus.CREATED)
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiCreatedResponse({ type: ManualInvoiceResponseDto })
  issueManual(
    @Param('shipmentId') shipmentId: string,
    @Body() dto: IssueManualInvoiceDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.invoices.issueManualInvoice(shipmentId, dto, idempotencyKey ?? '', this.actor(user));
  }

  @Post('invoices/:invoiceId/void-manual')
  @HttpCode(HttpStatus.OK)
  @RequireScopes(FULFILLMENT_SCOPE.SHIPMENT_REOPEN)
  @ApiOkResponse({ type: ManualInvoiceResponseDto })
  voidManual(
    @Param('invoiceId') invoiceId: string,
    @Body() dto: VoidManualInvoiceDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.invoices.voidManualInvoice(invoiceId, dto, idempotencyKey ?? '', this.actor(user));
  }

  private actor(user: AuthenticatedUser | undefined): ShipmentInvoiceActor {
    const id = user?.userId ?? user?.id ?? user?.sub;
    if (!id) throw new UnauthorizedException('Authenticated actor is required');
    return { id, roles: Array.isArray(user?.roles) ? user.roles : [] };
  }
}
