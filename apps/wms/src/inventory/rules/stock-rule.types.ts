import { wmsTables, wmsSchema } from '../../../database/schemas/wms-schema';

// stockSummary view의 타입 정의 (Drizzle에서 자동 추론)
type StockSummaryRow = typeof wmsSchema.stockSummary.$inferSelect;

export type StockUpdateData = Pick<
    StockSummaryRow,
    | 'onHandQty'
    | 'availableQty'
    | 'reservedQty'
    | 'inboundPendingQty'
    | 'onOrderQty'
    | 'inTransferQty'
    | 'defectiveQty'
    | 'transferPendingQty'
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