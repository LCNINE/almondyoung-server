import { ScopeDefinition } from '@app/authorization';

export const WALLET_SCOPES: ScopeDefinition[] = [
  {
    key: 'wallet.admin.read',
    category: 'wallet-admin',
    description: 'Wallet 관리자 조회',
  },
  {
    key: 'wallet.admin.audit.read',
    category: 'wallet-admin',
    description: 'Wallet 감사 로그 조회',
  },
  {
    key: 'wallet.admin.queue.write',
    category: 'wallet-admin',
    description: 'Wallet 수동 큐 처리',
  },
  {
    key: 'wallet.admin.manual_confirm.write',
    category: 'wallet-admin',
    description: 'Wallet 수동 결제 확정 처리',
  },
  {
    key: 'wallet.admin.refund.write',
    category: 'wallet-admin',
    description: 'Wallet 환불 승인/거절 처리',
  },
  {
    key: 'wallet.admin.reconcile.retry',
    category: 'wallet-admin',
    description: 'Wallet 정합성 재처리 실행',
  },
  {
    key: 'wallet.service.checkout.write',
    category: 'wallet-service',
    description: 'Wallet 결제 실행',
  },
  {
    key: 'wallet.service.intent.expire',
    category: 'wallet-service',
    description: 'Wallet 만료 처리 실행',
  },
];
