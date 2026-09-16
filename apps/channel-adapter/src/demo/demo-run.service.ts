import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { z } from 'zod';
import {
  DEFAULT_HAPPY_PATH_VARIANT_ID,
  DEFAULT_INVENTORY_SHORTAGE_VARIANT_ID,
  DEMO_FIXTURE_VERSION,
  demoRunItemIdentity,
  fixtureIdentityForVariant,
} from './demo-order.provider';

export const DEMO_RUN_REPOSITORY = Symbol('DEMO_RUN_REPOSITORY');

export const createDemoRunSchema = z.object({
  requestId: z.string().uuid(),
  scenario: z.enum(['happy_path', 'inventory_shortage']),
  count: z.coerce.number().int().min(1).max(50),
  variantId: z
    .string()
    .uuid()
    .refine((value) => {
      try {
        fixtureIdentityForVariant(value);
        return true;
      } catch {
        return false;
      }
    }, `variantId is not part of demo-logistics-v1`)
    .optional(),
  quantity: z.coerce.number().int().min(1).max(100).optional(),
});

export type CreateDemoRunRequest = z.infer<typeof createDemoRunSchema>;
export type DemoRunStatus = 'processing' | 'completed' | 'partial_failure' | 'failed';
export type DemoRunItemStatus = 'pending' | 'processing' | 'enqueued' | 'failed';

export interface PersistedDemoRunItem {
  id: string;
  runId: string;
  sequence: number;
  externalOrderId: string;
  orderId: string;
  status: DemoRunItemStatus;
  attempts: number;
  error: string | null;
  enqueuedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PersistedDemoRun {
  id: string;
  requestId: string;
  inputHash: string;
  fixtureVersion: string;
  scenario: CreateDemoRunRequest['scenario'];
  status: DemoRunStatus;
  count: number;
  variantId: string;
  quantity: number;
  requestedBy: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  items: PersistedDemoRunItem[];
}

export interface DemoRunRepositoryPort {
  createOrGet(run: PersistedDemoRun): Promise<PersistedDemoRun>;
  process(runId: string): Promise<void>;
  getById(id: string): Promise<PersistedDemoRun | null>;
  list(limit?: number): Promise<PersistedDemoRun[]>;
  count(): Promise<number>;
}

@Injectable()
export class DemoRunService {
  constructor(
    @Inject(DEMO_RUN_REPOSITORY)
    private readonly repository: DemoRunRepositoryPort,
  ) {}

  async create(request: CreateDemoRunRequest, actorId: string): Promise<PersistedDemoRun> {
    const normalized = normalizeRequest(request);
    const now = new Date();
    const inputHash = hashInput(normalized);
    const run: PersistedDemoRun = {
      id: normalized.requestId,
      requestId: normalized.requestId,
      inputHash,
      fixtureVersion: normalized.fixtureVersion,
      scenario: normalized.scenario,
      status: 'processing',
      count: normalized.count,
      variantId: normalized.variantId,
      quantity: normalized.quantity,
      requestedBy: actorId,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      items: Array.from({ length: normalized.count }, (_, index) => {
        const sequence = index + 1;
        const identity = demoRunItemIdentity(normalized.requestId, sequence);
        return {
          id: identity.id,
          runId: normalized.requestId,
          sequence,
          externalOrderId: identity.externalOrderId,
          orderId: identity.orderId,
          status: 'pending',
          attempts: 0,
          error: null,
          enqueuedAt: null,
          createdAt: now,
          updatedAt: now,
        };
      }),
    };

    const persisted = await this.repository.createOrGet(run);
    if (persisted.inputHash !== inputHash) {
      throw new ConflictException('requestId has already been used with different demo run input');
    }
    await this.repository.process(persisted.id);
    return (await this.repository.getById(persisted.id)) ?? persisted;
  }

  async get(id: string): Promise<PersistedDemoRun | null> {
    return this.repository.getById(id);
  }

  async list(limit = 20): Promise<{ items: PersistedDemoRun[]; total: number }> {
    const [items, total] = await Promise.all([this.repository.list(limit), this.repository.count()]);
    return { items, total };
  }
}

function normalizeRequest(request: CreateDemoRunRequest) {
  const variantId =
    request.variantId ??
    (request.scenario === 'inventory_shortage' ? DEFAULT_INVENTORY_SHORTAGE_VARIANT_ID : DEFAULT_HAPPY_PATH_VARIANT_ID);
  fixtureIdentityForVariant(variantId);
  return {
    requestId: request.requestId,
    fixtureVersion: DEMO_FIXTURE_VERSION,
    scenario: request.scenario,
    count: request.count,
    variantId,
    quantity: request.quantity ?? (request.scenario === 'inventory_shortage' ? 10 : 1),
  };
}

function hashInput(input: ReturnType<typeof normalizeRequest>): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}
