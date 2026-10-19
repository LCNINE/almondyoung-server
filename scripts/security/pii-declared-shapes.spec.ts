import { piiResponseOf, type PiiResponseSpec } from '@app/authorization';
import { maskPaths } from '@app/shared/pii';
import { Reflector } from '@nestjs/core';
import { UsersController as AdminUsersController } from 'apps/user-service/src/api/admin/users/users.controller';
import { PaymentIntentAdminController } from 'apps/wallet/src/admin/payment-intent-admin.controller';
import { AdminOperationsController } from 'apps/membership/src/controllers/admin-operations.controller';
import { SmsConversationsController } from 'apps/notification/src/sms-gate/controllers/sms-conversations.controller';

/**
 * 선언이 «실제로 올 수 있는 응답 모양»을 덮는지. 경로가 어긋나면 아무것도 가리지 않고 조용히 지나가므로,
 * 모양이 행마다 다르거나 문자열로 저장될 수 있는 값을 실제 선언에 대고 확인한다.
 */
const reflector = new Reflector();
const specOf = (handler: Parameters<Reflector['get']>[1]): PiiResponseSpec => {
  const spec = piiResponseOf(reflector, handler);
  if (!spec) throw new Error('no PiiResponse');
  return spec;
};

describe('개인정보 선언이 실제 응답 모양을 덮는다', () => {
  it('masks a member address stored as a JSON string as well as an object', () => {
    const spec = specOf(AdminUsersController.prototype.getUserById);
    for (const address of ['{"address_1":"서울특별시 송파구 중대로 135","postal_code":"05510"}', { address_1: '서울특별시 송파구 중대로 135', postal_code: '05510' }]) {
      const out = JSON.stringify(maskPaths({ id: 'u1', profile: { address } }, spec.fields).body);
      expect(out).not.toContain('중대로');
      expect(out).not.toContain('05510');
    }
  });

  it('hides every key of payment intent metadata, not only the known ones', () => {
    const spec = specOf(PaymentIntentAdminController.prototype.getDetail);
    const out = JSON.stringify(maskPaths({ id: 'pi', metadata: { buyerNote: '홍길동 010-1234-5678', customerName: '홍길동' } }, spec.fields).body);
    expect(out).not.toContain('010-1234-5678');
    expect(out).not.toContain('홍길동');
  });

  it('hides customer free text in membership contract event metadata', () => {
    const row = { userId: 'u1', metadata: { reasonText: '010-1234-5678 로 연락 주세요', receiveAccount: { accountNumber: '110123456789' } } };
    const cases: [Parameters<Reflector['get']>[1], unknown][] = [
      [AdminOperationsController.prototype.getMemberContractEvents, { success: true, data: [row] }],
      [AdminOperationsController.prototype.getContractEvents, { contractId: 'c1', events: [row] }],
    ];
    for (const [handler, body] of cases) {
      const out = JSON.stringify(maskPaths(body, specOf(handler).fields).body);
      expect(out).not.toContain('010-1234-5678');
      expect(out).not.toContain('110123456789');
    }
  });

  it('identifies a conversation with a non-member without putting the number in the log', () => {
    const list = specOf(SmsConversationsController.prototype.list);
    const detail = specOf(SmsConversationsController.prototype.detail);
    for (const spec of [list, detail]) {
      const hashed = spec.subjects.find((s) => s.hash === true);
      expect(hashed?.type).toBe('sms_conversation');
    }
  });
});
