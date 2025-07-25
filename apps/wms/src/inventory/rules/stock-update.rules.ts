import {
    Rule,
    CalcArgs,
    ApplyRuleOptions,
    StockUpdateData,
    EventType,
} from './stock-rule.types';
import { wmsTables } from '../../../database/schemas/wms-schema';




// IN: deltaQuantity > 0 (재고 증가)
// OUT: deltaQuantity < 0 (재고 감소)
// MOVE: 부호로 IN/OUT 판단
// RESERVE/CONFIRM/RELEASE: 별도 메서드에서 처리

export const STOCK_RULES: Readonly<Record<EventType, Rule>> = {
    // 입고 계열
    IN: {
        fields: { currentQuantity: '+', availableQuantity: '+' },
        description: '일반 입고'
    },
    IN_DOMESTIC: {
        fields: { currentQuantity: '+', availableQuantity: '+' },
        description: '국내 거래처 입고'
    },
    IN_OVERSEAS: {
        fields: { currentQuantity: '+', availableQuantity: '+' },
        description: '해외 거래처 입고'
    },
    IN_RETURN: {
        fields: { currentQuantity: '+', availableQuantity: '+' },
        custom: ({ existing, delta }) => ({
            returnPendingQuantity: Math.max(0, existing.returnPendingQuantity - Math.abs(delta)),
        }),
        description: '반품 입고 - 반품 대기 수량 감소'
    },

    // 출고 계열
    OUT: {
        fields: { currentQuantity: '+', availableQuantity: '+' },
        description: '일반 출고'
    },
    OUT_ORDER: {
        fields: { currentQuantity: '+', availableQuantity: '+' },
        description: '주문 출고'
    },
    OUT_DAMAGE: {
        fields: { currentQuantity: '+', availableQuantity: '+' },
        custom: ({ existing, delta }) => ({
            damageQuantity: existing.damageQuantity + Math.abs(delta),
        }),
        description: '파손 출고 - 손상 수량 증가'
    },
    OUT_LOSS: {
        fields: { currentQuantity: '+', availableQuantity: '+' },
        custom: ({ existing, delta }) => ({
            damageQuantity: existing.damageQuantity + Math.abs(delta),
        }),
        description: '분실 출고 - 손상 수량 증가'
    },
    OUT_DISPOSAL: {
        fields: { currentQuantity: '+', availableQuantity: '+' },
        custom: ({ existing, delta }) => ({
            damageQuantity: existing.damageQuantity + Math.abs(delta),
        }),
        description: '폐기 출고 - 손상 수량 증가'
    },

    // 이동 계열
    MOVE: {
        fields: { currentQuantity: '+', availableQuantity: '+' },
        description: '일반 이동'
    },
    MOVE_INTER_WAREHOUSE: {
        fields: { currentQuantity: '+', availableQuantity: '+' },
        custom: ({ existing, delta }) => {
            if (delta < 0) {
                // 출고 창고: 이동 중 수량 증가
                return { movingQuantity: existing.movingQuantity + Math.abs(delta) };
            }
            // 입고 창고: 이동 중 수량 감소
            return { movingQuantity: Math.max(0, existing.movingQuantity - delta) };
        },
        description: '창고 간 이동'
    },
    MOVE_INTRA_WAREHOUSE: {
        fields: { currentQuantity: '+', availableQuantity: '+' },
        description: '창고 내 이동'
    },

    // 조정 계열
    ADJUST: {
        fields: { currentQuantity: '+', availableQuantity: '+' },
        description: '일반 조정'
    },
    ADJUST_MANUAL: {
        fields: { currentQuantity: '+', availableQuantity: '+' },
        description: '관리자 수동 조정'
    },
    ADJUST_INVENTORY: {
        fields: { currentQuantity: '+', availableQuantity: '+' },
        description: '재고 실사 조정'
    },

    // 예약 계열
    RESERVE: {
        fields: {},
        description: '재고 예약 - 별도 메서드에서 처리'
    },
    CONFIRM: {
        fields: {},
        description: '예약 확정 - 별도 메서드에서 처리'
    },
    RELEASE: {
        fields: {},
        description: '예약 해제 - 별도 메서드에서 처리'
    },

    // 취소
    CANCEL: {
        fields: { currentQuantity: '+', availableQuantity: '+' },
        description: '취소 - 반대 델타값 적용'
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
    const eventTypes = wmsTables.stockEvents.eventType.enumValues;
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