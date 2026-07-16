import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Inject,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiHeader, ApiTags } from '@nestjs/swagger';
import { RequireScopes, ScopeGuard, User } from '@app/authorization';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { AssignToteDto, RegisterToteDto, ReleaseToteDto, ToteHandoffDto, ToteScanDto } from '../dto/tote.dto';
import {
  PickingActor,
  ToteAssignmentInput,
  ToteAssignmentResult,
  ToteHandoffInput,
  ToteHandoffResult,
  ToteRegistrationInput,
  ToteRegistrationResult,
  ToteReleaseInput,
  ToteReleaseResult,
  ToteScanPickingInput,
  ToteScanResult,
} from '../picking/picking-strategy.interface';
import { PickingProcessService } from '../services/picking-process.service';

type AuthenticatedUser = {
  id?: string;
  userId?: string;
  sub?: string;
  roles?: string[];
};

interface ToteCommandAdapter {
  registerTote(input: ToteRegistrationInput): Promise<ToteRegistrationResult>;
  assignTote(input: ToteAssignmentInput): Promise<ToteAssignmentResult>;
  toteScan(input: ToteScanPickingInput): Promise<ToteScanResult>;
  toteHandoff(input: ToteHandoffInput): Promise<ToteHandoffResult>;
  releaseTote(input: ToteReleaseInput): Promise<ToteReleaseResult>;
}

@ApiTags('Picking V2 Totes')
@Controller('picking/v2/totes')
@UseGuards(ScopeGuard)
export class ToteController {
  constructor(@Inject(PickingProcessService) private readonly picking: ToteCommandAdapter) {}

  @Post('registrations')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ description: 'Physical tote barcode registered for a warehouse' })
  register(
    @Body() dto: RegisterToteDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.picking.registerTote({
      ...dto,
      actor: this.actor(user),
      idempotencyKey: this.requiredIdempotencyKey(idempotencyKey),
    });
  }

  @Post('assignments')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ description: 'Physical tote assigned to shipment work' })
  assign(
    @Body() dto: AssignToteDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.picking.assignTote({
      ...dto,
      actor: this.actor(user),
      idempotencyKey: this.requiredIdempotencyKey(idempotencyKey),
    });
  }

  @Post('scans')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ description: 'Allocated source custody moved into the assigned physical tote' })
  scan(
    @Body() dto: ToteScanDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.picking.toteScan({
      ...dto,
      strategy: 'pick_to_tote',
      stage: 'source',
      actor: this.actor(user),
      idempotencyKey: this.requiredIdempotencyKey(idempotencyKey),
    });
  }

  @Post('handoffs')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ description: 'Empty physical tote reassigned to different shipment work' })
  handoff(
    @Body() dto: ToteHandoffDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.picking.toteHandoff({
      ...dto,
      actor: this.actor(user),
      idempotencyKey: this.requiredIdempotencyKey(idempotencyKey),
    });
  }

  @Post('releases')
  @RequireScopes(FULFILLMENT_SCOPE.WAREHOUSE_OPERATE)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ description: 'Empty or settled physical tote released while preserving assignment history' })
  release(
    @Body() dto: ReleaseToteDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @User() user: AuthenticatedUser,
  ) {
    return this.picking.releaseTote({
      ...dto,
      actor: this.actor(user),
      idempotencyKey: this.requiredIdempotencyKey(idempotencyKey),
    });
  }

  private actor(user: AuthenticatedUser | undefined): PickingActor {
    const id = user?.userId ?? user?.id ?? user?.sub;
    if (!id) throw new UnauthorizedException('Authenticated actor is required');
    return { id, roles: Array.isArray(user?.roles) ? user.roles : [] };
  }

  private requiredIdempotencyKey(value: string | undefined): string {
    const isVisibleAscii =
      typeof value === 'string' &&
      [...value].every((character) => {
        const code = character.charCodeAt(0);
        return code >= 33 && code <= 126;
      });
    if (!value || value.length > 200 || !isVisibleAscii) {
      throw new BadRequestException('A visible ASCII Idempotency-Key of at most 200 characters is required');
    }
    return value;
  }
}
