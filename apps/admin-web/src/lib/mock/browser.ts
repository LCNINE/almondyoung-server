import { setupWorker } from 'msw/browser';

// 도메인별 handlers
// import { allProductHandlers } from './handlers/products.handlers';
import { inventoryHandlers } from './handlers/inventory.handlers';
import { allOrderHandlers } from './handlers/orders.handlers';
import { allUserHandlers } from './handlers/users.handlers';

export const worker = setupWorker(
  // 도메인별 handlers
  // ...allProductHandlers,
  ...inventoryHandlers,
  ...allOrderHandlers,
  ...allUserHandlers,
);
// 자동 시작 제거 - MockProvider에서 처리
