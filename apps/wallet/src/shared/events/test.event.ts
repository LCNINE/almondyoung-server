import { BaseEvent } from './base.event';

/**
 * 테스트용 이벤트 클래스
 * 이벤트 인프라가 제대로 작동하는지 확인하기 위한 예제
 */
export class TestEvent extends BaseEvent {
    constructor(
        public readonly message: string,
        public readonly data: Record<string, any>,
        baseData: {
            correlationId?: string;
            actor: 'USER' | 'SYSTEM' | 'SCHEDULER' | 'ADMIN';
        }
    ) {
        super(baseData);
    }

    protected getEventData(): Record<string, any> {
        return {
            message: this.message,
            data: this.data,
        };
    }
}