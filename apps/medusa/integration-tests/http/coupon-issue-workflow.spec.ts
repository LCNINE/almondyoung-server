import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { PROMOTION_META_MODULE } from '../../src/modules/promotion-meta';
import type PromotionMetaModuleService from '../../src/modules/promotion-meta/service';
import {
  issueCouponGrantWorkflow,
  type IssueGrantRequest,
} from '../../src/workflows/coupons/workflows/issue-coupon-grant-workflow';

jest.setTimeout(120 * 1000);

// 워크플로가 배치를 받고 verdict 를 돌려준다 (PR-2 결정 3). 라우트 계약은 다른 스펙이 지키므로
// 여기는 워크플로 «자체»의 계약 둘만 본다 — 요청 단위 격리와 verdict 결정.
medusaIntegrationTestRunner({
  testSuite: ({ getContainer }) => {
    const svc = () => getContainer().resolve(PROMOTION_META_MODULE) as PromotionMetaModuleService;
    const run = (requests: IssueGrantRequest[]) =>
      issueCouponGrantWorkflow(getContainer()).run({ input: { requests } });

    describe('issueCouponGrantWorkflow — 배치 입력·verdict 출력', () => {
      it('요청 하나의 예외는 그 요청의 error 로 격리되고 나머지는 발급된다', async () => {
        await svc().upsert({ promotion_id: 'promo_wf_ok', max_claims: 5 });
        // promo_wf_bad 는 promotion_meta 행이 없다 — 상한 집행 요청이 오면 lockPromotionForIssue 가
        // fail-closed 로 던진다(서비스 독스트링). 그 예외가 배치를 죽이면 옛 라우트 셋이 지키던
        // 「한 고객의 장애가 나머지를 막지 않는다」가 깨진다.
        const { result } = await run([
          { promotion_id: 'promo_wf_bad', customer_id: 'cus_wf', issue_keys: ['k1'], issued_via: 'admin_manual', expires_at: null, max_claims: 1, enforce_cap: true },
          { promotion_id: 'promo_wf_ok', customer_id: 'cus_wf', issue_keys: ['k1', 'k2'], issued_via: 'admin_manual', expires_at: null, max_claims: 5, enforce_cap: true },
        ]);
        expect(result.results.map((r: any) => r.verdict)).toEqual(['error', 'issued']);
        expect(result.results[0].error).toMatch(/promotion_meta/);
        expect(result.results[1]).toMatchObject({ created: 2, duplicated: 0 });
        expect(await svc().countIssuedGrants('promo_wf_ok')).toBe(2);
      });

      it('verdict 는 created·duplicated·상한으로 결정된다 — issued → already_issued → partial → exhausted', async () => {
        await svc().upsert({ promotion_id: 'promo_wf_v', max_claims: 3 });
        const base = { promotion_id: 'promo_wf_v', issued_via: 'admin_manual' as const, expires_at: null, max_claims: 3, enforce_cap: true };

        const first = await run([{ ...base, customer_id: 'c1', issue_keys: ['a', 'b'] }]);
        expect(first.result.results[0]).toMatchObject({ verdict: 'issued', created: 2, duplicated: 0 });

        const again = await run([{ ...base, customer_id: 'c1', issue_keys: ['a', 'b'] }]);
        expect(again.result.results[0]).toMatchObject({ verdict: 'already_issued', created: 0, duplicated: 2 });

        const partial = await run([{ ...base, customer_id: 'c2', issue_keys: ['a', 'b'] }]); // 슬롯 1개 남음
        expect(partial.result.results[0]).toMatchObject({ verdict: 'partial', created: 1 });

        const none = await run([{ ...base, customer_id: 'c3', issue_keys: ['a'] }]);
        expect(none.result.results[0]).toMatchObject({ verdict: 'exhausted', created: 0 });

        expect(await svc().countIssuedGrants('promo_wf_v')).toBe(3);
      });
    });
  },
});
