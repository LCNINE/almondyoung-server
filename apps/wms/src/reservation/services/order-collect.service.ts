import { Injectable } from '@nestjs/common';

@Injectable()
export class OrderCollectService {
    getHello(): string {
        return 'Hello World!';
    }

    // TODO: 주문 수집 이벤트 수신 메서드

    // TODO: 주문 상태 관리 메서드

    // TODO: 상품 매칭 메서드

}