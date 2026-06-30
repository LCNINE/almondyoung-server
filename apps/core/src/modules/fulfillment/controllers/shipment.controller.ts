import { Controller, Post, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { User } from '@app/authorization';
import { ZodValidationPipe } from '@app/shared/pipes/zod-validation.pipe';
import { z } from 'zod';
import { ShipmentService } from '../services/shipment.service';

type AuthenticatedUser = { id?: string; userId?: string; sub?: string } | undefined;

const ScanSchema = z.object({ trackingNo: z.string().min(1) });
const InspectScanSchema = z.object({ barcode: z.string().min(1), quantity: z.number().int().positive().optional() });
const ForceSchema = z.object({ foiId: z.string().uuid().optional() });

/**
 * 박스(shipment) 작업자 동작 진입점 (Cluster A, EU3/EU5).
 * - POST /shipments/scan            송장 스캔으로 박스 lazy open
 * - POST /shipments/:id/inspect-scan 박스 라인 검수 스캔(전 라인 완료 시 consumeShipment 자동발사)
 * - POST /shipments/:id/force        강제출고(자동완료 override)
 */
@ApiTags('Shipments')
@Controller('shipments')
export class ShipmentController {
  constructor(private readonly shipments: ShipmentService) {}

  @Post('scan')
  @ApiOperation({ summary: '송장 스캔으로 박스 open' })
  async scan(@Body(new ZodValidationPipe(ScanSchema)) dto: z.infer<typeof ScanSchema>, @User() user?: AuthenticatedUser) {
    return this.shipments.openBoxByScan(dto.trackingNo, this.userId(user));
  }

  @Post(':id/inspect-scan')
  @ApiOperation({ summary: '박스 라인 검수 스캔' })
  @ApiParam({ name: 'id', description: '박스(shipment) ID' })
  async inspect(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(InspectScanSchema)) dto: z.infer<typeof InspectScanSchema>,
    @User() user?: AuthenticatedUser,
  ) {
    await this.shipments.inspectScan(id, dto.barcode, dto.quantity ?? 1, this.userId(user));
    return { ok: true };
  }

  @Post(':id/force')
  @ApiOperation({ summary: '강제출고 (자동완료 override)' })
  @ApiParam({ name: 'id', description: '박스(shipment) ID' })
  async force(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ForceSchema)) dto: z.infer<typeof ForceSchema>,
    @User() user?: AuthenticatedUser,
  ) {
    await this.shipments.forceShipment(id, dto.foiId, this.userId(user));
    return { ok: true };
  }

  private userId(user?: AuthenticatedUser): string | undefined {
    return user?.id ?? user?.userId ?? user?.sub;
  }
}
