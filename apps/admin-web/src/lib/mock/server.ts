import { setupServer } from 'msw/node';

// 도메인별 handlers
import { allProductHandlers } from './handlers/products.handlers';
import { inventoryHandlers } from './handlers/inventory.handlers';
import { allOrderHandlers } from './handlers/orders.handlers';
import { allUserHandlers } from './handlers/users.handlers';

// 서버용 MSW 설정
export const server = setupServer(
    // 도메인별 handlers
    ...allProductHandlers,
    ...inventoryHandlers,
    ...allOrderHandlers,
    ...allUserHandlers,
);
