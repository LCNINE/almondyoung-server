import { wmsTables } from '../../../database/schemas/wms-schema';

type StockSummaryRow = typeof wmsTables.stockSummary.$inferSelect;

export type StockUpdateData = Pick<
    StockSummaryRow,
    | 'currentQuantity'
    | 'availableQuantity'
    | 'reservedQuantity'
    | 'inboundPendingQuantity'
    | 'outboundPendingQuantity'
    | 'movingQuantity'
    | 'damageQuantity'
    | 'returnPendingQuantity'
>;

export type EventType = (typeof wmsTables.stockEvents.eventType.enumValues)[number];

export type Op =
    | '+'        // base + delta
    | 'abs+'     // base + abs(delta)
    | 'max0-';   // max(0, base - delta)

export type Field = keyof StockUpdateData;

export interface Rule {
    fields: Partial<Record<Field, Op>>;
    custom?: (args: CalcArgs) => Partial<StockUpdateData>;
    validate?: (args: CalcArgs) => void; // optional
    description?: string; // optional
}

export interface CalcArgs {
    existing: StockUpdateData;
    delta: number;
    eventType: EventType;
    fromWarehouseId?: string;
    toWarehouseId?: string;
}

export interface ApplyRuleOptions {
    onNegative?: 'clamp' | 'throw' | 'log-and-clamp';
}