import { Rule, CalcArgs, ApplyRuleOptions, StockUpdateData, EventType } from './stock-rule.types';
import { wmsTables } from '../../../database/schemas/wms-schema';




// IN: deltaQuantity > 0 (재고 증가)
// OUT: deltaQuantity < 0 (재고 감소)
// MOVE: 부호로 IN/OUT 판단
// RESERVE/CONFIRM/RELEASE: 별도 메서드에서 처리

export const STOCK_RULES: Readonly<Record<EventType, Rule>> = {
    // 기본 흐름
    RECEIVE: {
        fields: { currentQuantity: '+', availableQuantity: '+' },
        description: '입고'
    },
    RESERVE_SALES: {
        fields: { availableQuantity: '+', reservedQuantity: '+' },
        description: '판매 예약'
    },
    UNRESERVE_SALES: {
        fields: { availableQuantity: '+', reservedQuantity: '+' },
        description: '판매 예약 해제'
    },
    SHIP: {
        fields: { currentQuantity: '+', reservedQuantity: '+' },
        description: '출고'
    },
    MOVE: {
        fields: { currentQuantity: '+', availableQuantity: '+' },
        description: '이동 (창고내/창고간)'
    },

    // 품질 관리 (불량품 전용)
    MARK_DEFECT: {
        fields: { availableQuantity: '+' },
        custom: ({ existing, delta }) => ({
            defectiveQuantity: existing.defectiveQuantity + Math.abs(delta)
        }),
        description: '불량 지정'
    },
    REWORK_GOOD: {
        fields: { availableQuantity: '+' },
        custom: ({ existing, delta }) => ({
            defectiveQuantity: existing.defectiveQuantity - Math.abs(delta)
        }),
        description: '불량 양품화'
    },
    SCRAP: {
        fields: { currentQuantity: '+' },
        custom: ({ existing, delta, eventType }) => {
            // DEFECTIVE에서 오는 경우 defectiveQuantity 감소
            const fromDefective = existing.defectiveQuantity > 0;
            return fromDefective ? {
                defectiveQuantity: existing.defectiveQuantity - Math.abs(delta)
            } : {};
        },
        description: '폐기'
    },

    // 수동 조정 (reason 필드로 상세 사유 기록)
    ADJUST_UP: {
        fields: { currentQuantity: '+', availableQuantity: '+' },
        description: '재고 증가 (입고 정정, 발견, 출고 취소 등)'
    },
    ADJUST_DOWN: {
        fields: { currentQuantity: '+', availableQuantity: '+' },
        description: '재고 감소 (입고 취소, 감모, 운송 분실/파손 등)'
    },

    // 예약 관리 (필요시)
    RESERVE_MOVE: {
        fields: { availableQuantity: '+', movingQuantity: '+' },
        description: '이동 예약'
    },
    UNRESERVE_MOVE: {
        fields: { availableQuantity: '+', movingQuantity: '+' },
        description: '이동 예약 취소'
    },
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
        defectiveQuantity: 0,
        returnPendingQuantity: 0,
    };
}