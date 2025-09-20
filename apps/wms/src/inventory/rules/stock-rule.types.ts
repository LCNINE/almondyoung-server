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
    | 'defectiveQuantity'
    | 'returnPendingQuantity'
>;

// TransitionType derived strictly from DB enum
export type TransitionType = (typeof wmsTables.stockEvents.transitionType.enumValues)[number];

// EventType equals TransitionType (no legacy support)
export type EventType = TransitionType;

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