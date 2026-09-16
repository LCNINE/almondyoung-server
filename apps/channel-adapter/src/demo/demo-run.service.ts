import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { z } from 'zod';
import { DemoCatalogClient, type DemoCatalogItem } from './demo-catalog.client';
import {
  DEFAULT_HAPPY_PATH_VARIANT_ID,
  DEFAULT_INVENTORY_SHORTAGE_VARIANT_ID,
  DEMO_FIXTURE_VERSION,
  demoRunItemIdentity,
  demoRunLineIdentity,
  type DemoPersistedOrderLine,
} from './demo-order.provider';

export const DEMO_RUN_REPOSITORY = Symbol('DEMO_RUN_REPOSITORY');

const uuidList = z
  .array(z.string().uuid())
  .max(100)
  .transform((values) => [...new Set(values)]);

export const createDemoRunSchema = z
  .object({
    requestId: z.string().uuid(),
    scenario: z.enum(['happy_path', 'inventory_shortage']),
    count: z.coerce.number().int().min(1).max(50),
    mode: z.enum(['specified', 'random']).optional(),
    variantIds: uuidList.optional(),
    productsPerOrder: z.coerce.number().int().min(1).max(5).optional(),
    minQuantity: z.coerce.number().int().min(1).max(100).optional(),
    maxQuantity: z.coerce.number().int().min(1).max(100).optional(),
    variantId: z.string().uuid().optional(),
    quantity: z.coerce.number().int().min(1).max(100).optional(),
  })
  .superRefine((value, context) => {
    const usesLegacy = value.variantId !== undefined || value.quantity !== undefined;
    const usesMulti =
      value.mode !== undefined ||
      value.variantIds !== undefined ||
      value.productsPerOrder !== undefined ||
      value.minQuantity !== undefined ||
      value.maxQuantity !== undefined;
    if (usesLegacy && usesMulti) {
      context.addIssue({
        code: 'custom',
        message: 'legacy variantId/quantity cannot be mixed with multi-product fields',
      });
    }
    if (value.mode === 'specified' && !value.variantIds?.length) {
      context.addIssue({ code: 'custom', path: ['variantIds'], message: 'specified mode requires variantIds' });
    }
    const products = value.productsPerOrder ?? (value.mode === 'specified' ? value.variantIds?.length : 1);
    if (products !== undefined && products > 5) {
      context.addIssue({
        code: 'custom',
        path: ['productsPerOrder'],
        message: 'productsPerOrder cannot exceed 5',
      });
    }
    if (value.mode === 'specified' && products && value.variantIds && products > value.variantIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['productsPerOrder'],
        message: 'productsPerOrder cannot exceed the number of specified variants',
      });
    }
    if (value.minQuantity !== undefined && value.maxQuantity !== undefined && value.minQuantity > value.maxQuantity) {
      context.addIssue({ code: 'custom', path: ['maxQuantity'], message: 'maxQuantity must be at least minQuantity' });
    }
  });

export type CreateDemoRunRequest = z.infer<typeof createDemoRunSchema>;
export type DemoRunStatus = 'processing' | 'completed' | 'partial_failure' | 'failed';
export type DemoRunItemStatus = 'pending' | 'processing' | 'enqueued' | 'failed';

export interface NormalizedDemoRunInput {
  requestId: string;
  fixtureVersion: string;
  scenario: CreateDemoRunRequest['scenario'];
  count: number;
  mode: 'specified' | 'random';
  variantIds: string[];
  productsPerOrder: number;
  minQuantity: number;
  maxQuantity: number;
}

export interface PersistedDemoRunItem {
  id: string;
  runId: string;
  sequence: number;
  externalOrderId: string;
  orderId: string;
  lines: DemoPersistedOrderLine[];
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
  input: NormalizedDemoRunInput;
  requestedBy: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  items: PersistedDemoRunItem[];
}

export interface DemoRunRepositoryPort {
  createOrGet(run: PersistedDemoRun): Promise<PersistedDemoRun>;
  process(runId: string): Promise<void>;
  getByRequestId(requestId: string): Promise<PersistedDemoRun | null>;
  getById(id: string): Promise<PersistedDemoRun | null>;
  list(limit?: number): Promise<PersistedDemoRun[]>;
  count(): Promise<number>;
}

@Injectable()
export class DemoRunService {
  constructor(
    @Inject(DEMO_RUN_REPOSITORY)
    private readonly repository: DemoRunRepositoryPort,
    private readonly catalog: DemoCatalogClient,
  ) {}

  async create(request: CreateDemoRunRequest, actorId: string, authorization: string): Promise<PersistedDemoRun> {
    const normalized = normalizeRequest(request);
    const existing = await this.repository.getByRequestId(normalized.requestId);
    if (existing) return this.replay(existing, normalized);

    const catalog = await this.catalog.list(
      normalized.mode === 'random'
        ? {
            variantIds: normalized.variantIds.length ? normalized.variantIds : undefined,
            randomSeed: normalized.requestId,
            availableOnly: normalized.scenario === 'happy_path' ? true : undefined,
          }
        : { variantIds: normalized.variantIds },
      authorization,
    );
    const now = new Date();
    const items = planDemoRunItems(normalized, catalog, now);
    const firstLine = items[0].lines[0];
    const run: PersistedDemoRun = {
      id: normalized.requestId,
      requestId: normalized.requestId,
      inputHash: hashInput(normalized),
      fixtureVersion: normalized.fixtureVersion,
      scenario: normalized.scenario,
      status: 'processing',
      count: normalized.count,
      variantId: firstLine.variantId,
      quantity: firstLine.quantity,
      input: normalized,
      requestedBy: actorId,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      items,
    };

    const persisted = await this.repository.createOrGet(run);
    return this.replay(persisted, normalized);
  }

  async get(id: string): Promise<PersistedDemoRun | null> {
    return this.repository.getById(id);
  }

  async list(limit = 20): Promise<{ items: PersistedDemoRun[]; total: number }> {
    const [items, total] = await Promise.all([this.repository.list(limit), this.repository.count()]);
    return { items, total };
  }

  private async replay(existing: PersistedDemoRun, normalized: NormalizedDemoRunInput): Promise<PersistedDemoRun> {
    if (!sameInput(existing.input, normalized)) {
      throw new ConflictException('requestId has already been used with different demo run input');
    }
    await this.repository.process(existing.id);
    return (await this.repository.getById(existing.id)) ?? existing;
  }
}

export function normalizeRequest(request: CreateDemoRunRequest): NormalizedDemoRunInput {
  const legacy = request.mode === undefined && request.variantIds === undefined;
  if (legacy) {
    const variantId =
      request.variantId ??
      (request.scenario === 'inventory_shortage'
        ? DEFAULT_INVENTORY_SHORTAGE_VARIANT_ID
        : DEFAULT_HAPPY_PATH_VARIANT_ID);
    const quantity = request.quantity ?? (request.scenario === 'inventory_shortage' ? 10 : 1);
    return {
      requestId: request.requestId,
      fixtureVersion: DEMO_FIXTURE_VERSION,
      scenario: request.scenario,
      count: request.count,
      mode: 'specified',
      variantIds: [variantId],
      productsPerOrder: 1,
      minQuantity: quantity,
      maxQuantity: request.scenario === 'inventory_shortage' ? 100 : quantity,
    };
  }

  const variantIds = [...new Set(request.variantIds ?? [])].sort();
  const mode = request.mode ?? 'random';
  return {
    requestId: request.requestId,
    fixtureVersion: 'core-demo-catalog-v1',
    scenario: request.scenario,
    count: request.count,
    mode,
    variantIds,
    productsPerOrder: request.productsPerOrder ?? (mode === 'specified' ? variantIds.length : 1),
    minQuantity: request.minQuantity ?? 1,
    maxQuantity: request.maxQuantity ?? (request.scenario === 'inventory_shortage' ? 100 : (request.minQuantity ?? 1)),
  };
}

export function planDemoRunItems(
  input: NormalizedDemoRunInput,
  catalogRows: DemoCatalogItem[],
  createdAt: Date,
): PersistedDemoRunItem[] {
  const byVariant = new Map(catalogRows.map((item) => [item.variantId, item]));
  if (input.mode === 'specified') {
    const missing = input.variantIds.filter((id) => !byVariant.has(id));
    if (missing.length) throw new BadRequestException(`Selected variants are unavailable: ${missing.join(', ')}`);
  }
  const candidates = [...catalogRows].sort((a, b) => a.variantId.localeCompare(b.variantId));
  if (candidates.length < input.productsPerOrder) {
    throw new BadRequestException(
      `Demo catalog candidate pool has ${candidates.length} variants; ${input.productsPerOrder} are required per order`,
    );
  }

  const variantRemaining = new Map(candidates.map((item) => [item.variantId, item.availableQuantity]));
  const componentRemaining = new Map<string, number>();
  for (const item of candidates) {
    for (const component of item.components) {
      const current = componentRemaining.get(component.skuId);
      componentRemaining.set(
        component.skuId,
        current === undefined ? component.availableQuantity : Math.min(current, component.availableQuantity),
      );
    }
  }

  const items: PersistedDemoRunItem[] = [];
  for (let orderIndex = 0; orderIndex < input.count; orderIndex += 1) {
    const sequence = orderIndex + 1;
    const ordered =
      input.mode === 'random'
        ? [...candidates].sort((a, b) =>
            stableRank(`${input.requestId}:${sequence}:${a.variantId}`).localeCompare(
              stableRank(`${input.requestId}:${sequence}:${b.variantId}`),
            ),
          )
        : rotate(
            input.variantIds.map((id) => byVariant.get(id)!),
            orderIndex * input.productsPerOrder,
          );
    const selected: { item: DemoCatalogItem; quantity: number }[] = [];
    for (const candidate of ordered) {
      if (selected.length === input.productsPerOrder) break;
      const desiredQuantity = quantityFor(input, sequence, selected.length + 1, candidate.variantId);
      const quantity =
        input.scenario === 'inventory_shortage'
          ? desiredQuantity
          : Math.min(desiredQuantity, maxReservable(candidate, variantRemaining, componentRemaining));
      if (input.scenario === 'inventory_shortage' || quantity >= input.minQuantity) {
        selected.push({ item: candidate, quantity });
        if (input.scenario === 'happy_path') reserve(candidate, quantity, variantRemaining, componentRemaining);
      }
    }
    if (selected.length < input.productsPerOrder) {
      throw new BadRequestException(
        `Demo catalog candidate pool cannot satisfy aggregate stock for ${input.count} orders; reduce count, productsPerOrder, or minQuantity`,
      );
    }
    const identity = demoRunItemIdentity(input.requestId, sequence);
    items.push({
      id: identity.id,
      runId: input.requestId,
      sequence,
      externalOrderId: identity.externalOrderId,
      orderId: identity.orderId,
      lines: selected.map(({ item, quantity }, index) => toLine(input, item, sequence, index + 1, quantity)),
      status: 'pending',
      attempts: 0,
      error: null,
      enqueuedAt: null,
      createdAt,
      updatedAt: createdAt,
    });
  }

  if (input.scenario === 'inventory_shortage') forceShortage(input, catalogRows, items);
  return items;
}

function toLine(
  input: NormalizedDemoRunInput,
  item: DemoCatalogItem,
  sequence: number,
  lineSequence: number,
  quantity: number,
): DemoPersistedOrderLine {
  return {
    orderItemId: demoRunLineIdentity(input.requestId, sequence, lineSequence),
    skuId: item.skuId,
    masterId: item.masterId,
    versionId: item.versionId,
    variantId: item.variantId,
    sku: item.sku,
    productName: item.productName,
    availableQuantity: item.availableQuantity,
    components: item.components,
    quantity,
    unitPrice: item.unitPrice,
    totalPrice: item.unitPrice * quantity,
  };
}

function maxReservable(item: DemoCatalogItem, variants: Map<string, number>, components: Map<string, number>): number {
  return Math.min(
    variants.get(item.variantId) ?? 0,
    ...item.components.map((component) => Math.floor((components.get(component.skuId) ?? 0) / component.quantity)),
  );
}

function reserve(
  item: DemoCatalogItem,
  quantity: number,
  variants: Map<string, number>,
  components: Map<string, number>,
): void {
  variants.set(item.variantId, (variants.get(item.variantId) ?? 0) - quantity);
  for (const component of item.components) {
    components.set(component.skuId, (components.get(component.skuId) ?? 0) - component.quantity * quantity);
  }
}

function forceShortage(
  input: NormalizedDemoRunInput,
  catalogRows: DemoCatalogItem[],
  items: PersistedDemoRunItem[],
): void {
  const catalog = new Map(catalogRows.map((item) => [item.variantId, item]));
  const demand = calculateDemand(items, catalog);
  const availability = calculateAvailability(catalogRows);
  if ([...demand].some(([resource, value]) => value > (availability.get(resource) ?? 0))) return;

  const lines = items.flatMap((item) => item.lines);
  for (const [resource, available] of availability) {
    let additionalDemand = available - (demand.get(resource) ?? 0) + 1;
    const consumers = lines
      .map((line) => ({ line, units: resourceUnits(resource, line, catalog) }))
      .filter(({ units }) => units > 0);
    const additionalCapacity = consumers.reduce(
      (sum, { line, units }) => sum + (input.maxQuantity - line.quantity) * units,
      0,
    );
    if (additionalCapacity < additionalDemand) continue;

    for (const { line, units } of consumers) {
      const delta = Math.min(input.maxQuantity - line.quantity, Math.ceil(additionalDemand / units));
      line.quantity += delta;
      line.totalPrice = line.unitPrice * line.quantity;
      additionalDemand -= delta * units;
      if (additionalDemand <= 0) return;
    }
  }
  throw new BadRequestException(
    `inventory_shortage cannot exceed current stock within maxQuantity=${input.maxQuantity}`,
  );
}

function resourceUnits(resource: string, line: DemoPersistedOrderLine, catalog: Map<string, DemoCatalogItem>): number {
  if (resource === `variant:${line.variantId}`) return 1;
  if (!resource.startsWith('sku:')) return 0;
  const skuId = resource.slice(4);
  return catalog
    .get(line.variantId)!
    .components.filter((component) => component.skuId === skuId)
    .reduce((sum, component) => sum + component.quantity, 0);
}

function calculateDemand(items: PersistedDemoRunItem[], catalog: Map<string, DemoCatalogItem>): Map<string, number> {
  const demand = new Map<string, number>();
  for (const line of items.flatMap((item) => item.lines)) {
    const catalogItem = catalog.get(line.variantId)!;
    add(demand, `variant:${line.variantId}`, line.quantity);
    for (const component of catalogItem.components) {
      add(demand, `sku:${component.skuId}`, line.quantity * component.quantity);
    }
  }
  return demand;
}

function calculateAvailability(items: DemoCatalogItem[]): Map<string, number> {
  const availability = new Map<string, number>();
  for (const item of items) {
    availability.set(`variant:${item.variantId}`, item.availableQuantity);
    for (const component of item.components) {
      const key = `sku:${component.skuId}`;
      availability.set(
        key,
        Math.min(availability.get(key) ?? component.availableQuantity, component.availableQuantity),
      );
    }
  }
  return availability;
}

function add(map: Map<string, number>, key: string, amount: number): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function rotate<T>(values: T[], offset: number): T[] {
  const normalized = offset % values.length;
  return [...values.slice(normalized), ...values.slice(0, normalized)];
}

function stableRank(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function quantityFor(input: NormalizedDemoRunInput, sequence: number, lineSequence: number, variantId: string): number {
  if (input.scenario === 'inventory_shortage') return input.minQuantity;
  const range = input.maxQuantity - input.minQuantity + 1;
  const rank = Number.parseInt(
    stableRank(`${input.requestId}:${sequence}:${lineSequence}:${variantId}`).slice(0, 8),
    16,
  );
  return input.minQuantity + (rank % range);
}

function hashInput(input: NormalizedDemoRunInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        input.requestId,
        input.scenario,
        input.count,
        input.mode,
        input.variantIds,
        input.productsPerOrder,
        input.minQuantity,
        input.maxQuantity,
      ]),
    )
    .digest('hex');
}

function sameInput(left: NormalizedDemoRunInput, right: NormalizedDemoRunInput): boolean {
  return hashInput(left) === hashInput(right);
}
