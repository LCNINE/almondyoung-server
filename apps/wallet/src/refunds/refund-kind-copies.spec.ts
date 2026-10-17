import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { refundKindEnum } from '../schema';

/**
 * 환불 종류의 «복사본»이 정본(`refundKindEnum`)과 같은지 지키는 가드 (#1016 40번).
 *
 * 호출자들은 앱 간 import 를 할 수 없어 종류 철자를 옮겨 둔다. wallet 이 값을 바꾸거나 지우면 wallet 의 `@IsIn` 이
 * 옛 철자를 400 으로 막아 «라벨 하나 때문에 환불이 막힌다»(스펙 §3 이 막으려는 것). 그래서 복사본을 파일에서 읽어 비교한다.
 * Medusa 스펙은 루트 jest 가 무시하지만 이 파일은 apps/wallet 에 있어 루트 jest 가 돈다.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const CANON: string[] = [...refundKindEnum.enumValues].sort();

/** 같은 집합이어야 하는 복사본 — 파일과 그 안의 선언을 찾는 패턴 */
const LIST_COPIES = [
  {
    file: 'apps/medusa/src/modules/almond-payment/refund-data.ts',
    declaration: /export const WALLET_REFUND_KINDS\s*=\s*\[([^\]]*)\]/,
  },
  {
    file: 'apps/core/src/modules/sales-order/services/wallet-refund.client.ts',
    declaration: /export type WalletRefundKind\s*=([^;]*);/,
  },
  {
    file: 'apps/admin-web/src/lib/api/domains/wallet/refund-kind.ts',
    declaration: /export const REFUND_KINDS\s*=\s*\[([^\]]*)\]/,
  },
] as const;

/** 한 값만 싣는 호출자 — 그 값이 정본에 있어야 한다 */
const MEMBER_COPIES = [
  { file: 'apps/membership/src/services/billing/payment-client.service.ts', literal: /\bkind:\s*['"]([^'"]+)['"]/g },
] as const;

function read(file: string): string {
  return readFileSync(join(REPO_ROOT, file), 'utf8');
}

function literals(source: string): string[] {
  return [...source.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

describe('환불 종류 복사본 = wallet refundKindEnum (#1016 40번)', () => {
  it.each(LIST_COPIES)('$file 의 종류 목록이 정본과 같다', ({ file, declaration }) => {
    const match = declaration.exec(read(file));
    if (!match) {
      throw new Error(
        `${file}: 종류 선언(${declaration.source})을 못 찾았다 — 선언을 옮겼으면 이 가드의 패턴을 고칠 것`,
      );
    }
    const copy = [...new Set(literals(match[1]))].sort();
    if (JSON.stringify(copy) !== JSON.stringify(CANON)) {
      throw new Error(
        `${file} 의 환불 종류가 정본(apps/wallet/src/schema.ts refundKindEnum)과 다르다 — 이 파일을 고칠 것.\n` +
          `  정본: ${CANON.join(', ')}\n  복사: ${copy.join(', ')}`,
      );
    }
  });

  it.each(MEMBER_COPIES)('$file 이 싣는 종류가 정본에 있다', ({ file, literal }) => {
    const found = [...read(file).matchAll(literal)].map((m) => m[1]);
    if (found.length === 0) {
      throw new Error(`${file}: 환불 종류 리터럴(kind: '…')을 못 찾았다 — 옮겼으면 이 가드의 패턴을 고칠 것`);
    }
    const unknown = found.filter((k) => !CANON.includes(k));
    if (unknown.length > 0) {
      throw new Error(
        `${file} 이 정본(apps/wallet/src/schema.ts refundKindEnum)에 없는 환불 종류를 싣는다 — 이 파일을 고칠 것: ${unknown.join(', ')}`,
      );
    }
  });
});
