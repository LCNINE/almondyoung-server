import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { User } from '@app/authorization';
import { z } from 'zod';
import { DemoDispatchOutcomeReader } from './demo-dispatch-outcome.reader';
import { DEMO_FIXTURE_VERSION } from './demo-order.provider';
import { DemoModeGuard } from './demo-mode.guard';
import { createDemoRunSchema, DemoRunService, PersistedDemoRun } from './demo-run.service';

const idSchema = z.string().uuid();
const limitSchema = z.coerce.number().int().min(1).max(100).default(20);

@Controller('demo')
@UseGuards(DemoModeGuard)
export class DemoController {
  constructor(
    private readonly runs: DemoRunService,
    private readonly dispatchOutcomes: DemoDispatchOutcomeReader,
  ) {}

  @Get('capabilities')
  capabilities() {
    return {
      enabled: true,
      stage: 'demo' as const,
      externalIntegrationsMode: 'mock' as const,
      fixtureVersion: DEMO_FIXTURE_VERSION,
      salesChannel: 'medusa' as const,
      scenarios: ['happy_path', 'inventory_shortage'] as const,
      maxCount: 50,
      modes: ['specified', 'random'] as const,
      maxProductsPerOrder: 5,
      maxQuantity: 100,
    };
  }

  @Post('runs')
  @HttpCode(202)
  async createRun(
    @Body() body: unknown,
    @User('userId') actorId: string,
    @Headers('authorization') authorization?: string,
    @Headers('cookie') cookie?: string,
  ) {
    const request = parseOrBadRequest(createDemoRunSchema, body);
    return toDetail(await this.runs.create(request, actorId, authorizationForCore(authorization, cookie)));
  }

  @Get('runs')
  async listRuns(@Query('limit') rawLimit?: string) {
    const limit = parseOrBadRequest(limitSchema, rawLimit);
    const result = await this.runs.list(limit);
    return { items: result.items.map(toSummary), total: result.total };
  }

  @Get('runs/:id')
  async getRun(@Param('id') rawId: string) {
    const id = parseOrBadRequest(idSchema, rawId);
    const run = await this.runs.get(id);
    if (!run) throw new NotFoundException(`Demo run ${id} was not found`);
    return toDetail(run);
  }

  @Get('dispatch-outcomes')
  async listDispatchOutcomes(@Query('limit') rawLimit?: string) {
    const limit = parseOrBadRequest(limitSchema, rawLimit);
    return this.dispatchOutcomes.list(limit);
  }
}

function parseOrBadRequest<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException({
      message: 'Invalid demo request',
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
  }
  return parsed.data;
}

function toSummary(run: PersistedDemoRun) {
  const summary = summarize(run);
  return {
    id: run.id,
    requestId: run.requestId,
    fixtureVersion: run.fixtureVersion,
    scenario: run.scenario,
    status: run.status,
    count: run.count,
    variantId: run.variantId,
    quantity: run.quantity,
    summary,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
  };
}

function toDetail(run: PersistedDemoRun) {
  return {
    ...toSummary(run),
    input: {
      requestId: run.input.requestId,
      scenario: run.input.scenario,
      count: run.input.count,
      mode: run.input.mode,
      variantIds: run.input.variantIds,
      productsPerOrder: run.input.productsPerOrder,
      minQuantity: run.input.minQuantity,
      maxQuantity: run.input.maxQuantity,
    },
    items: run.items.map((item) => ({
      id: item.id,
      sequence: item.sequence,
      externalOrderId: item.externalOrderId,
      orderId: item.orderId,
      lines: item.lines,
      status: item.status,
      attempts: item.attempts,
      error: item.error,
      enqueuedAt: item.enqueuedAt?.toISOString() ?? null,
    })),
  };
}

export function authorizationForCore(authorization?: string, cookie?: string): string {
  if (authorization?.startsWith('Bearer ')) return authorization;
  const encodedToken = cookie?.match(/(?:^|;\s*)accessToken=([^;]+)/)?.[1];
  if (!encodedToken) throw new BadRequestException('Unable to forward the requesting admin authorization to Core');
  return `Bearer ${decodeURIComponent(encodedToken)}`;
}

function summarize(run: PersistedDemoRun) {
  return {
    requested: run.count,
    enqueued: run.items.filter((item) => item.status === 'enqueued').length,
    failed: run.items.filter((item) => item.status === 'failed').length,
  };
}
