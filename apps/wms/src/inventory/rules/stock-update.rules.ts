import { Rule, CalcArgs, ApplyRuleOptions, StockUpdateData, EventType } from './stock-rule.types';
import { wmsTables } from '../../../database/schemas/wms-schema';




// IN: deltaQuantity > 0 (재고 증가)
// OUT: deltaQuantity < 0 (재고 감소)
// MOVE: 부호로 IN/OUT 판단
// RESERVE/CONFIRM/RELEASE: 별도 메서드에서 처리

export const STOCK_RULES: Readonly<Record<EventType, Rule>> = {
    // 전이 타입 기반 규칙 (입고/출고/이동/예약/품질/조정/폐기)
    RECEIVE: { fields: { currentQuantity: '+', availableQuantity: '+' }, description: '입고' },
    RECEIPT_CORRECTION_UP: { fields: { currentQuantity: '+', availableQuantity: '+' }, description: '입고 정정 증가' },
    RECEIPT_CORRECTION_DOWN: { fields: { currentQuantity: '+', availableQuantity: '+' }, description: '입고 정정 감소(역이벤트로 처리됨)' },
    RECEIPT_REVERSAL: { fields: { currentQuantity: '+', availableQuantity: '+' }, description: '입고 역분개' },

    RESERVE_SALES: { fields: {}, description: '판매 예약(요약에서 예약 수량 별도 처리)' },
    UNRESERVE_SALES: { fields: {}, description: '판매 예약 해제(요약에서 예약 수량 별도 처리)' },
    SHIP: { fields: { currentQuantity: '+', availableQuantity: '+' }, description: '출고' },
    SHIP_REVERSAL: { fields: { currentQuantity: '+', availableQuantity: '+' }, description: '출고 역분개' },

    MOVE_RESERVE: { fields: {}, description: '로케이션 이동 예약' },
    MOVE_CANCEL: { fields: {}, description: '로케이션 이동 예약 취소' },
    MOVE_COMMIT: { fields: { currentQuantity: '+', availableQuantity: '+' }, description: '로케이션 이동 확정' },
    MOVE_INSTANT: { fields: {}, description: '로케이션 즉시 이동(요약은 이벤트 투영에서 처리)' },

    TRANSFER_SHIP: { fields: { currentQuantity: '+', availableQuantity: '+' }, description: '창고 간 선적(출발 창고 감소, 이동 중 처리 별도)' },
    TRANSFER_RECEIVE: { fields: { currentQuantity: '+', availableQuantity: '+' }, description: '창고 간 도착(도착 창고 증가)' },
    TRANSFER_CANCEL_SHIP: { fields: { currentQuantity: '+', availableQuantity: '+' }, description: '선적 취소' },
    TRANSFER_LOSS: { fields: { currentQuantity: '+', availableQuantity: '+' }, custom: ({ existing, delta }) => ({ damageQuantity: existing.damageQuantity + Math.abs(delta) }), description: '운송 중 분실' },
    TRANSFER_DAMAGE: { fields: { currentQuantity: '+', availableQuantity: '+' }, custom: ({ existing, delta }) => ({ damageQuantity: existing.damageQuantity + Math.abs(delta) }), description: '운송 중 파손' },

    MARK_DEFECT: { fields: { currentQuantity: '+', availableQuantity: '+' }, description: '불량 지정' },
    REWORK_GOOD: { fields: { currentQuantity: '+', availableQuantity: '+' }, description: '수리 후 정상 전환' },
    QUARANTINE_HOLD: { fields: { currentQuantity: '+', availableQuantity: '+' }, description: '격리 보류' },
    QUARANTINE_RELEASE: { fields: { currentQuantity: '+', availableQuantity: '+' }, description: '격리 해제' },

    ADJUST_UP: { fields: { currentQuantity: '+', availableQuantity: '+' }, description: '조정 증가' },
    ADJUST_DOWN: { fields: { currentQuantity: '+', availableQuantity: '+' }, description: '조정 감소' },
    SCRAP: { fields: { currentQuantity: '+', availableQuantity: '+' }, description: '폐기' },
    UNSCRAP: { fields: { currentQuantity: '+', availableQuantity: '+' }, description: '폐기 복원' },
} as const;

// 규칙 적용 함수
export function applyRule(
    args: CalcArgs,
    rule: Rule,
    opts: ApplyRuleOptions = { onNegative: 'clamp' }
): Partial<StockUpdateData> {
    const { existing, delta } = args;
    const next: Partial<StockUpdateData> = {};

    if (rule.validate) {
        rule.validate(args);
    }

    for (const [field, op] of Object.entries(rule.fields)) {
        if (!op) continue;

        const currentValue = (existing as any)[field] ?? 0;

        switch (op) {
            case '+':
                (next as any)[field] = currentValue + delta;
                break;
            case 'abs+':
                (next as any)[field] = currentValue + Math.abs(delta);
                break;
            case 'max0-':
                (next as any)[field] = Math.max(0, currentValue - delta);
                break;
        }
    }

    if (rule.custom) {
        Object.assign(next, rule.custom(args));
    }

    return handleNegative(next, opts);
}

// 음수 값 처리
function handleNegative(
    update: Partial<StockUpdateData>,
    { onNegative }: ApplyRuleOptions
): Partial<StockUpdateData> {
    for (const [key, value] of Object.entries(update)) {
        if (typeof value !== 'number' || value >= 0) continue;

        switch (onNegative) {
            case 'throw':
                throw new Error(`Negative value detected at field "${key}": ${value}`);

            case 'log-and-clamp':
                console.warn(`[StockRule] Negative value clamped: ${key}=${value} → 0`);
                (update as any)[key] = 0;
                break;

            default:
                (update as any)[key] = 0;
        }
    }

    return update;
}

// 유틸리티: 규칙 검증 (테스트용)
export function validateRules(): void {
    const eventTypes = wmsTables.stockEvents.transitionType.enumValues;
    const missingRules = eventTypes.filter(type => !STOCK_RULES[type as EventType]);

    if (missingRules.length > 0) {
        throw new Error(`Missing rules for event types: ${missingRules.join(', ')}`);
    }
}

// 유틸리티: 초기 상태 생성
export function createInitialState(): StockUpdateData {
    return {
        currentQuantity: 0,
        availableQuantity: 0,
        reservedQuantity: 0,
        inboundPendingQuantity: 0,
        outboundPendingQuantity: 0,
        movingQuantity: 0,
        damageQuantity: 0,
        returnPendingQuantity: 0,
    };
}