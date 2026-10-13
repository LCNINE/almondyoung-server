import { implies, requirementCovered, scanFile } from './mutation-guard-scan';

describe('mutation guard scan', () => {
  it('reads the permission declared after a mutation hook, through a local helper and a factory too', () => {
    const scan = scanFile(
      'm.ts',
      `
      function useKeyed(fn) { return useMutation({ mutationFn: fn }); }
      export const useA = () => useMutation({ mutationFn: a });
      useA.permission = ['order.order.cancel'] as const satisfies PermissionRequirement;
      export const useB = () => useKeyed(b);
      useB.permission = { allOf: [['payment.refund.execute'], ['order.order.cancel']] } as const;
      export const useC = Object.assign(makeHook('x'), { permission: ['fulfillment.warehouse.operate'] as const });
      function makeHook(k) { return () => useMutation({ mutationFn: k }); }
      export const useD = () => useMutation({ mutationFn: d });
    `,
    );
    expect(scan.hooks.map((h) => [h.name, h.requirement])).toEqual([
      ['useA', ['order.order.cancel']],
      ['useB', { allOf: [['payment.refund.execute'], ['order.order.cancel']] }],
      ['useC', ['fulfillment.warehouse.operate']],
      ['useD', null],
    ]);
    expect(scan.inline).toEqual([]);
  });

  it('asks a mutation made inside a component to declare its permission in meta', () => {
    const scan = scanFile(
      'c.tsx',
      `
      export function Memo() {
        const a = useMutation({ mutationFn: save, meta: { permission: ['order.order.write'] } });
        const b = useMutation({ mutationFn: other });
        return null;
      }
    `,
    );
    expect(scan.inline.map((m) => m.requirement)).toEqual([['order.order.write'], null]);
  });

  it('collects every kind of permission check, across lines', () => {
    const scan = scanFile(
      'v.tsx',
      `
      export function V() {
        const { canRun, can } = usePermissionCheck();
        const s = useCan(['order.order.read']);
        const r = useCanRun(useA);
        return (<>
          <Can
            anyOf={['catalog.product.write']}>x</Can>
          <Can run={[useB, useC]}>y</Can>
          <PermissionFieldset run={useD}>z</PermissionFieldset>
          {canRun(useE) && <button />}
          {can(['inventory.stock.adjust']) && <button />}
          <RouteGuard screen="/mall/notices">w</RouteGuard>
          <CanOpen screen="/mall/product-registration">v</CanOpen>
          {useCanOpen('/inventory/skus').status}
        </>);
      }
    `,
    );
    expect([...scan.guardKeys].sort()).toEqual(['catalog.product.write', 'inventory.stock.adjust', 'order.order.read']);
    expect([...scan.guardRuns].sort()).toEqual(['useA', 'useB', 'useC', 'useD', 'useE']);
    expect([...scan.screens].sort()).toEqual(['/inventory/skus', '/mall/notices', '/mall/product-registration']);
  });

  it('treats an alias of a mutation hook as the same hook with the same permission', () => {
    const scan = scanFile('m.ts', `
      export const useSave = () => useMutation({ mutationFn: save });
      useSave.permission = ['catalog.product.write'] as const;
      export const useLegacySave = useSave;
    `);
    expect(scan.hooks.map((h) => [h.name, h.requirement])).toEqual([
      ['useSave', ['catalog.product.write']],
      ['useLegacySave', ['catalog.product.write']],
    ]);
  });

  it('reads both branches of a conditional run target', () => {
    const scan = scanFile('v.tsx', `
      export function V({ editing }) {
        return <PermissionReadOnly run={editing ? useUpdateX : useCreateX}>x</PermissionReadOnly>;
      }
    `);
    expect([...scan.guardRuns].sort()).toEqual(['useCreateX', 'useUpdateX']);
  });

  it('treats an empty or non-literal declaration as missing', () => {
    const scan = scanFile(
      'm.ts',
      `
      export const useA = () => useMutation({});
      useA.permission = [] as const;
      export const useB = () => useMutation({});
      useB.permission = KEYS;
    `,
    );
    expect(scan.hooks.map((h) => h.requirement)).toEqual([null, null]);
  });

  it('lets a write check cover a read on the same target, never the other way', () => {
    expect(implies('messaging.message.bulk_send', 'messaging.message.read')).toBe(true);
    expect(implies('messaging.message.read', 'messaging.message.send')).toBe(false);
    expect(implies('messaging.template.write', 'messaging.message.read')).toBe(false);
    expect(requirementCovered({ allOf: [['payment.refund.execute'], ['order.order.cancel']] }, new Set(['payment.refund.execute']))).toBe(false);
  });
});
