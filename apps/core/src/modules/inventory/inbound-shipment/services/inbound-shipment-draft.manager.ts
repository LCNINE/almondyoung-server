import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import { InboundShipmentSkuMatcherReader, SkuMatch } from './inbound-shipment-sku-matcher.reader';
import { LineIssue, ListInput, ParsedLine, expandBoxLabel, parseShipmentList } from './inbound-shipment-list.parser';
import { ConfirmBlocker, confirmBlockers, lineEditable } from './inbound-shipment.rules';
import { MAX_BOX_RANGE } from './inbound-shipment-list.parser';

export interface CreateDraftInput {
  warehouseId: string;
  name: string;
  expectedArrival: string | null;
  sourceFileId: string | null;
  sourceFileName: string;
  list: ListInput;
}

const BOX_CHUNK = 2_000;
const LINE_CHUNK = 1_000;
const COVER_CHUNK = 10_000;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type LinePatch = { kind: 'sku'; skuId: string } | { kind: 'free' };
export interface BoxPatch {
  disposition?: 'stock' | 'forward';
  forwardNote?: string | null;
  label?: string;
}
export interface HeaderPatch {
  name?: string;
  expectedArrival?: string | null;
  memo?: string | null;
}

const BLOCKER_LIST_LIMIT = 10;
const MAX_AI_CANDIDATES = 5;

const MATCH_ISSUE: Record<'none' | 'many' | 'packing_unit', LineIssue> = {
  none: 'barcode_not_found',
  many: 'barcode_ambiguous',
  packing_unit: 'packing_unit_barcode',
};

/** 파싱된 리스트로 선적 초안(draft)을 한 트랜잭션에 만든다 — spec §6.1. */
@Injectable()
export class InboundShipmentDraftManager {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly matcher: InboundShipmentSkuMatcherReader,
  ) {}

  async createDraft(input: CreateDraftInput, actorId: string, tx?: DbTx): Promise<{ shipmentId: string }> {
    const parsed = parseShipmentList(input.list);
    return this.dbService.run(async (trx: DbTx) => {
      const [warehouse] = await trx
        .select({ id: wmsTables.warehouses.id })
        .from(wmsTables.warehouses)
        .where(eq(wmsTables.warehouses.id, input.warehouseId))
        .limit(1);
      if (!warehouse) throw new NotFoundError(`Warehouse not found: ${input.warehouseId}`);

      const barcodes = parsed.lines.flatMap((l) => (l.barcode ? [l.barcode] : []));
      const matches = await this.matcher.match(barcodes, trx);

      const [shipment] = await trx
        .insert(wmsTables.inboundShipments)
        .values({
          warehouseId: input.warehouseId,
          status: 'draft',
          name: input.name,
          expectedArrival: input.expectedArrival,
          sourceFileId: input.sourceFileId,
          sourceFileName: input.sourceFileName,
          createdBy: actorId,
        })
        .returning({ id: wmsTables.inboundShipments.id });

      const boxIdByLabel = new Map<string, string>();
      for (const part of chunks(parsed.boxes, BOX_CHUNK)) {
        const rows = await trx
          .insert(wmsTables.inboundShipmentBoxes)
          .values(
            part.map((b) => ({
              shipmentId: shipment.id,
              label: b.label,
              sortKey: b.sortKey,
              origin: 'list' as const,
              disposition: b.forwardHint === null ? ('stock' as const) : ('forward' as const),
              forwardNote: b.forwardHint,
            })),
          )
          .returning({ id: wmsTables.inboundShipmentBoxes.id, label: wmsTables.inboundShipmentBoxes.label });
        for (const r of rows) boxIdByLabel.set(r.label, r.id);
      }

      // 줄 id 는 미리 만든다 — 덮기를 RETURNING 행 매핑이 아니라 이 id 로 짓는다
      const drafts = parsed.lines.map((line) => ({
        id: randomUUID(),
        line,
        ...this.lineValues(shipment.id, line, matches),
      }));
      for (const part of chunks(drafts, LINE_CHUNK)) {
        await trx.insert(wmsTables.inboundShipmentLines).values(part.map(({ line: _line, ...values }) => values));
      }

      const cover = drafts.flatMap(({ id: lineId, line }) => {
        return [...new Set(line.boxLabels)].flatMap((label) => {
          const boxId = boxIdByLabel.get(label);
          return boxId ? [{ lineId, boxId }] : [];
        });
      });
      for (const part of chunks(cover, COVER_CHUNK)) {
        await trx.insert(wmsTables.inboundShipmentLineBoxes).values(part);
      }
      return { shipmentId: shipment.id };
    }, tx);
  }

  /** 줄을 사람이 확정한다. 확정 뒤엔 kind 를 sku/free 사이로만 바꾼다 — spec §6.4. */
  async editLine(
    shipmentId: string,
    lineId: string,
    patch: LinePatch,
    extra: { expectedQty?: number; boxLabels?: string[] },
    actorId: string,
    tx?: DbTx,
  ): Promise<void> {
    return this.dbService.run(async (trx: DbTx) => {
      const shipment = await this.lockShipment(trx, shipmentId);
      const [line] = await trx
        .select()
        .from(wmsTables.inboundShipmentLines)
        .where(
          and(eq(wmsTables.inboundShipmentLines.id, lineId), eq(wmsTables.inboundShipmentLines.shipmentId, shipmentId)),
        )
        .limit(1);
      if (!line) throw new NotFoundError(`Inbound shipment line not found: ${lineId}`);

      if (extra.boxLabels !== undefined && shipment.status !== 'draft') {
        throw new ConflictError('확정 뒤에는 줄이 덮는 상자를 바꿀 수 없습니다.');
      }
      const covered = await trx
        .select({ status: wmsTables.inboundShipmentBoxes.status })
        .from(wmsTables.inboundShipmentLineBoxes)
        .innerJoin(
          wmsTables.inboundShipmentBoxes,
          eq(wmsTables.inboundShipmentBoxes.id, wmsTables.inboundShipmentLineBoxes.boxId),
        )
        .where(eq(wmsTables.inboundShipmentLineBoxes.lineId, lineId));
      if (
        !lineEditable(
          shipment.status,
          covered.map((c) => c.status),
        )
      ) {
        throw new ConflictError('이미 받은 상자가 있거나 닫힌 선적의 줄은 고칠 수 없습니다.');
      }

      const expectedQty = extra.expectedQty ?? line.expectedQty;
      if (extra.expectedQty !== undefined && (!Number.isInteger(extra.expectedQty) || extra.expectedQty <= 0)) {
        throw new BadRequestError('수량은 1 이상의 정수여야 합니다.');
      }
      if (expectedQty === null || expectedQty <= 0) throw new BadRequestError('수량을 먼저 정해야 합니다.');

      if (patch.kind === 'sku') {
        const [sku] = await trx
          .select({ id: wmsTables.skus.id })
          .from(wmsTables.skus)
          .where(eq(wmsTables.skus.id, patch.skuId))
          .limit(1);
        if (!sku) throw new BadRequestError(`SKU not found: ${patch.skuId}`);
      }

      const labels = extra.boxLabels === undefined ? null : this.expandLabels(extra.boxLabels);
      await trx
        .update(wmsTables.inboundShipmentLines)
        .set({
          kind: patch.kind,
          skuId: patch.kind === 'sku' ? patch.skuId : null,
          expectedQty,
          resolution: 'manual',
          resolvedBy: actorId,
          resolvedAt: new Date(),
        })
        .where(eq(wmsTables.inboundShipmentLines.id, lineId));

      if (labels) await this.replaceCoverage(trx, shipmentId, lineId, labels);
      await this.touchShipment(trx, shipmentId);
    }, tx);
  }

  async editBox(shipmentId: string, boxId: string, patch: BoxPatch, _actorId: string, tx?: DbTx): Promise<void> {
    return this.dbService.run(async (trx: DbTx) => {
      const shipment = await this.lockShipment(trx, shipmentId);
      if (shipment.status === 'closed' || shipment.status === 'canceled') {
        throw new ConflictError('닫히거나 취소된 선적의 상자는 고칠 수 없습니다.');
      }
      const [box] = await trx
        .select()
        .from(wmsTables.inboundShipmentBoxes)
        .where(
          and(eq(wmsTables.inboundShipmentBoxes.id, boxId), eq(wmsTables.inboundShipmentBoxes.shipmentId, shipmentId)),
        )
        .limit(1);
      if (!box) throw new NotFoundError(`Inbound shipment box not found: ${boxId}`);
      if (box.status !== 'open') throw new ConflictError('이미 받은 상자는 고칠 수 없습니다.');

      const set: Partial<typeof wmsTables.inboundShipmentBoxes.$inferInsert> = {};
      if (patch.disposition !== undefined) {
        if (shipment.status !== 'draft' && patch.disposition !== box.disposition) {
          await this.assertFlipKeepsConfirmRules(trx, boxId, patch.disposition);
        }
        set.disposition = patch.disposition;
        if (patch.disposition === 'stock' && patch.forwardNote === undefined) set.forwardNote = null;
      }
      if (patch.forwardNote !== undefined) set.forwardNote = patch.forwardNote;
      if (patch.label !== undefined) {
        if (shipment.status !== 'draft') throw new ConflictError('확정 뒤에는 상자 이름을 바꿀 수 없습니다.');
        const labels = this.expandLabels([patch.label]);
        if (labels.length !== 1) throw new BadRequestError(`상자 이름은 하나여야 합니다: ${patch.label}`);
        const [label] = labels;
        if (label !== box.label) {
          const [dup] = await trx
            .select({ id: wmsTables.inboundShipmentBoxes.id })
            .from(wmsTables.inboundShipmentBoxes)
            .where(
              and(
                eq(wmsTables.inboundShipmentBoxes.shipmentId, shipmentId),
                eq(wmsTables.inboundShipmentBoxes.label, label),
              ),
            )
            .limit(1);
          if (dup) throw new ConflictError(`같은 이름의 상자가 이미 있습니다: ${label}`);
        }
        set.label = label;
      }
      if (Object.keys(set).length === 0) return;
      await trx
        .update(wmsTables.inboundShipmentBoxes)
        .set({ ...set, version: sql`${wmsTables.inboundShipmentBoxes.version} + 1` })
        .where(eq(wmsTables.inboundShipmentBoxes.id, boxId));
      await this.touchShipment(trx, shipmentId);
    }, tx);
  }

  /** AI 는 후보만 적는다 — kind·skuId 는 건드리지 않는다 (spec §7). */
  async setAiCandidates(
    shipmentId: string,
    lineId: string,
    candidates: { skuId: string; reason: string }[],
    tx?: DbTx,
  ): Promise<void> {
    return this.dbService.run(async (trx: DbTx) => {
      const shipment = await this.lockShipment(trx, shipmentId);
      if (shipment.status !== 'draft') throw new ConflictError('초안일 때만 후보를 적을 수 있습니다.');
      const [line] = await trx
        .select({ kind: wmsTables.inboundShipmentLines.kind })
        .from(wmsTables.inboundShipmentLines)
        .where(
          and(eq(wmsTables.inboundShipmentLines.id, lineId), eq(wmsTables.inboundShipmentLines.shipmentId, shipmentId)),
        )
        .limit(1);
      if (!line) throw new NotFoundError(`Inbound shipment line not found: ${lineId}`);
      if (line.kind !== 'unresolved') throw new ConflictError('미확인 줄에만 후보를 적을 수 있습니다.');
      if (candidates.length > MAX_AI_CANDIDATES) throw new BadRequestError(`후보는 최대 ${MAX_AI_CANDIDATES}개입니다.`);

      const ids = [...new Set(candidates.map((c) => c.skuId))];
      if (ids.length > 0) {
        const found = await trx
          .select({ id: wmsTables.skus.id })
          .from(wmsTables.skus)
          .where(inArray(wmsTables.skus.id, ids));
        if (found.length !== ids.length) throw new BadRequestError('존재하지 않는 SKU 가 후보에 있습니다.');
      }
      await trx
        .update(wmsTables.inboundShipmentLines)
        .set({ aiCandidates: candidates.map((c) => ({ skuId: c.skuId, reason: c.reason })) })
        .where(eq(wmsTables.inboundShipmentLines.id, lineId));
      await this.touchShipment(trx, shipmentId);
    }, tx);
  }

  async confirm(
    shipmentId: string,
    actorId: string,
    tx?: DbTx,
  ): Promise<{ shipmentId: string; status: 'expected'; labelOverlaps: string[] }> {
    return this.dbService.run(async (trx: DbTx) => {
      const shipment = await this.lockShipment(trx, shipmentId);
      if (shipment.status !== 'draft') throw new ConflictError('초안만 확정할 수 있습니다.');

      const boxes = await trx
        .select()
        .from(wmsTables.inboundShipmentBoxes)
        .where(eq(wmsTables.inboundShipmentBoxes.shipmentId, shipmentId))
        .orderBy(wmsTables.inboundShipmentBoxes.sortKey);
      const lines = await trx
        .select({
          id: wmsTables.inboundShipmentLines.id,
          kind: wmsTables.inboundShipmentLines.kind,
          rowNumber: wmsTables.inboundShipmentLines.rowNumber,
        })
        .from(wmsTables.inboundShipmentLines)
        .where(eq(wmsTables.inboundShipmentLines.shipmentId, shipmentId))
        .orderBy(wmsTables.inboundShipmentLines.rowNumber);
      const cover = await trx
        .select({ lineId: wmsTables.inboundShipmentLineBoxes.lineId, boxId: wmsTables.inboundShipmentLineBoxes.boxId })
        .from(wmsTables.inboundShipmentLineBoxes)
        .innerJoin(
          wmsTables.inboundShipmentLines,
          eq(wmsTables.inboundShipmentLines.id, wmsTables.inboundShipmentLineBoxes.lineId),
        )
        .where(eq(wmsTables.inboundShipmentLines.shipmentId, shipmentId));
      const boxIdsByLine = new Map<string, string[]>();
      for (const c of cover) boxIdsByLine.set(c.lineId, [...(boxIdsByLine.get(c.lineId) ?? []), c.boxId]);

      const blockers = confirmBlockers(
        boxes,
        lines.map((l) => ({ id: l.id, kind: l.kind, boxIds: boxIdsByLine.get(l.id) ?? [] })),
      );
      if (blockers.length > 0) {
        throw new ConflictError(this.blockerMessage(blockers, lines, boxes));
      }

      await trx
        .update(wmsTables.inboundShipments)
        .set({ status: 'expected', confirmedAt: new Date(), confirmedBy: actorId, updatedAt: new Date() })
        .where(eq(wmsTables.inboundShipments.id, shipmentId));

      const labels = boxes.map((b) => b.label);
      const overlapRows =
        labels.length === 0
          ? []
          : await trx
              .selectDistinct({ label: wmsTables.inboundShipmentBoxes.label })
              .from(wmsTables.inboundShipmentBoxes)
              .innerJoin(
                wmsTables.inboundShipments,
                eq(wmsTables.inboundShipments.id, wmsTables.inboundShipmentBoxes.shipmentId),
              )
              .where(
                and(
                  eq(wmsTables.inboundShipments.warehouseId, shipment.warehouseId),
                  ne(wmsTables.inboundShipments.id, shipmentId),
                  inArray(wmsTables.inboundShipments.status, ['expected', 'receiving']),
                  inArray(wmsTables.inboundShipmentBoxes.label, labels),
                ),
              );
      const overlapping = new Set(overlapRows.map((r) => r.label));
      return { shipmentId, status: 'expected' as const, labelOverlaps: labels.filter((l) => overlapping.has(l)) };
    }, tx);
  }

  async cancel(shipmentId: string, actorId: string, tx?: DbTx): Promise<{ shipmentId: string; status: 'canceled' }> {
    return this.dbService.run(async (trx: DbTx) => {
      const shipment = await this.lockShipment(trx, shipmentId);
      if (shipment.status === 'expected') {
        const [received] = await trx
          .select({ n: sql<number>`count(*)::int` })
          .from(wmsTables.inboundShipmentBoxes)
          .where(
            and(
              eq(wmsTables.inboundShipmentBoxes.shipmentId, shipmentId),
              eq(wmsTables.inboundShipmentBoxes.status, 'received'),
            ),
          );
        if (received.n > 0) throw new ConflictError('받은 상자가 있어 취소할 수 없습니다.');
      } else if (shipment.status !== 'draft') {
        throw new ConflictError('초안이거나, 받은 상자가 없는 확정 선적만 취소할 수 있습니다.');
      }
      await trx
        .update(wmsTables.inboundShipments)
        .set({ status: 'canceled', canceledAt: new Date(), canceledBy: actorId, updatedAt: new Date() })
        .where(eq(wmsTables.inboundShipments.id, shipmentId));
      return { shipmentId, status: 'canceled' as const };
    }, tx);
  }

  async updateHeader(shipmentId: string, patch: HeaderPatch, tx?: DbTx): Promise<void> {
    return this.dbService.run(async (trx: DbTx) => {
      const shipment = await this.lockShipment(trx, shipmentId);
      if (shipment.status === 'canceled') throw new ConflictError('취소된 선적은 고칠 수 없습니다.');
      if (patch.name !== undefined && patch.name.trim() === '') throw new BadRequestError('이름을 비울 수 없습니다.');
      const set: Partial<typeof wmsTables.inboundShipments.$inferInsert> = { updatedAt: new Date() };
      if (patch.name !== undefined) set.name = patch.name.trim();
      if (patch.expectedArrival !== undefined) set.expectedArrival = patch.expectedArrival;
      if (patch.memo !== undefined) set.memo = patch.memo;
      await trx.update(wmsTables.inboundShipments).set(set).where(eq(wmsTables.inboundShipments.id, shipmentId));
    }, tx);
  }

  private async touchShipment(trx: DbTx, shipmentId: string): Promise<void> {
    await trx.update(wmsTables.inboundShipments).set({ updatedAt: new Date() }).where(eq(wmsTables.inboundShipments.id, shipmentId));
  }

  /** 확정 뒤 구분을 바꿔도 §6.2 의 «미확인 줄·섞인 줄» 규칙이 깨지지 않아야 한다. */
  private async assertFlipKeepsConfirmRules(trx: DbTx, boxId: string, next: 'stock' | 'forward'): Promise<void> {
    const lineIds = (
      await trx
        .select({ lineId: wmsTables.inboundShipmentLineBoxes.lineId })
        .from(wmsTables.inboundShipmentLineBoxes)
        .where(eq(wmsTables.inboundShipmentLineBoxes.boxId, boxId))
    ).map((r) => r.lineId);
    if (lineIds.length === 0) return;
    const rows = await trx
      .select({
        lineId: wmsTables.inboundShipmentLineBoxes.lineId,
        kind: wmsTables.inboundShipmentLines.kind,
        rowNumber: wmsTables.inboundShipmentLines.rowNumber,
        boxId: wmsTables.inboundShipmentBoxes.id,
        disposition: wmsTables.inboundShipmentBoxes.disposition,
      })
      .from(wmsTables.inboundShipmentLineBoxes)
      .innerJoin(wmsTables.inboundShipmentLines, eq(wmsTables.inboundShipmentLines.id, wmsTables.inboundShipmentLineBoxes.lineId))
      .innerJoin(wmsTables.inboundShipmentBoxes, eq(wmsTables.inboundShipmentBoxes.id, wmsTables.inboundShipmentLineBoxes.boxId))
      .where(inArray(wmsTables.inboundShipmentLineBoxes.lineId, lineIds));
    const boxes = new Map(
      rows.map((r) => [r.boxId, { id: r.boxId, disposition: r.boxId === boxId ? next : r.disposition, origin: 'added' as const }]),
    );
    const lines = lineIds.map((id) => {
      const mine = rows.filter((r) => r.lineId === id);
      return { id, kind: mine[0].kind, boxIds: mine.map((r) => r.boxId) };
    });
    const blockers = confirmBlockers([...boxes.values()], lines).filter((b) => b.code !== 'empty_box');
    if (blockers.length === 0) return;
    const rowOf = new Map(rows.map((r) => [r.lineId, r.rowNumber]));
    const names = blockers.map((b) => `${rowOf.get(b.lineId)}행`);
    throw new ConflictError(
      `구분을 바꾸면 확정 규칙이 깨집니다 (상품이 정해지지 않은 줄이 입고 상자에 얹히거나 입고·전달 상자가 섞이는 줄: ${[...new Set(names)].join(', ')}).`,
    );
  }

  private async lockShipment(trx: DbTx, shipmentId: string) {
    const [shipment] = await trx
      .select()
      .from(wmsTables.inboundShipments)
      .where(eq(wmsTables.inboundShipments.id, shipmentId))
      .for('update');
    if (!shipment) throw new NotFoundError(`Inbound shipment not found: ${shipmentId}`);
    return shipment;
  }

  private expandLabels(raw: string[]): string[] {
    const out: string[] = [];
    for (const text of raw) {
      const { labels, issue } = expandBoxLabel(text);
      if (issue !== null || labels.length === 0) throw new BadRequestError(`상자 이름을 읽을 수 없습니다: ${text}`);
      for (const l of labels) if (!out.includes(l)) out.push(l);
    }
    if (out.length === 0) throw new BadRequestError('상자를 하나 이상 지정해야 합니다.');
    if (out.length > MAX_BOX_RANGE) throw new BadRequestError(`한 번에 ${MAX_BOX_RANGE}개를 넘는 상자를 지정할 수 없습니다.`);
    return out;
  }

  private async replaceCoverage(trx: DbTx, shipmentId: string, lineId: string, labels: string[]): Promise<void> {
    const existing = await trx
      .select({
        id: wmsTables.inboundShipmentBoxes.id,
        label: wmsTables.inboundShipmentBoxes.label,
        sortKey: wmsTables.inboundShipmentBoxes.sortKey,
      })
      .from(wmsTables.inboundShipmentBoxes)
      .where(eq(wmsTables.inboundShipmentBoxes.shipmentId, shipmentId));
    const idByLabel = new Map(existing.map((b) => [b.label, b.id]));
    let nextSort = existing.reduce((m, b) => Math.max(m, b.sortKey), -1) + 1;
    const missing = labels.filter((l) => !idByLabel.has(l));
    if (missing.length > 0) {
      const created = await trx
        .insert(wmsTables.inboundShipmentBoxes)
        .values(missing.map((label) => ({ shipmentId, label, sortKey: nextSort++, origin: 'list' as const })))
        .returning({ id: wmsTables.inboundShipmentBoxes.id, label: wmsTables.inboundShipmentBoxes.label });
      for (const c of created) idByLabel.set(c.label, c.id);
    }
    await trx.delete(wmsTables.inboundShipmentLineBoxes).where(eq(wmsTables.inboundShipmentLineBoxes.lineId, lineId));
    await trx
      .insert(wmsTables.inboundShipmentLineBoxes)
      .values(
        labels.flatMap((l) => {
          const boxId = idByLabel.get(l);
          return boxId === undefined ? [] : [{ lineId, boxId }];
        }),
      );
  }

  private blockerMessage(
    blockers: ConfirmBlocker[],
    lines: { id: string; rowNumber: number }[],
    boxes: { id: string; label: string }[],
  ): string {
    const rowOf = new Map(lines.map((l) => [l.id, l.rowNumber]));
    const labelOf = new Map(boxes.map((b) => [b.id, b.label]));
    const list = (items: string[]) =>
      items.length > BLOCKER_LIST_LIMIT
        ? `${items.slice(0, BLOCKER_LIST_LIMIT).join(', ')} 외 ${items.length - BLOCKER_LIST_LIMIT}건`
        : items.join(', ');
    const parts: string[] = [];
    const unresolved = blockers.flatMap((b) => (b.code === 'unresolved_line' ? [`${rowOf.get(b.lineId)}행`] : []));
    const mixed = blockers.flatMap((b) => (b.code === 'mixed_disposition' ? [`${rowOf.get(b.lineId)}행`] : []));
    const empty = blockers.flatMap((b) => (b.code === 'empty_box' ? [labelOf.get(b.boxId) ?? b.boxId] : []));
    if (unresolved.length > 0) parts.push(`상품이 정해지지 않은 줄 ${unresolved.length}건 (${list(unresolved)})`);
    if (mixed.length > 0) parts.push(`입고 상자와 전달 상자를 함께 덮는 줄 ${mixed.length}건 (${list(mixed)})`);
    if (empty.length > 0) parts.push(`줄이 없는 상자 ${empty.length}개 (${list(empty)})`);
    return `확정할 수 없습니다: ${parts.join(' / ')}`;
  }

  private lineValues(shipmentId: string, line: ParsedLine, matches: Map<string, SkuMatch>) {
    const match = line.barcode ? matches.get(line.barcode) : undefined;
    const issues: LineIssue[] = [...line.issues];
    if (match && match.kind !== 'one') issues.push(MATCH_ISSUE[match.kind]);

    const resolved = match?.kind === 'one' && line.expectedQty !== null && line.boxLabels.length > 0;
    return {
      shipmentId,
      rowNumber: line.rowNumber,
      raw: line.raw,
      kind: resolved ? ('sku' as const) : ('unresolved' as const),
      skuId: resolved ? match.skuId : null,
      expectedQty: line.expectedQty,
      resolution: resolved ? ('barcode' as const) : null,
      issues: [...new Set(issues)],
    };
  }
}
