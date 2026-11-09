import { setLineItemReservationsWorkflow } from '../workflows';

// 워크플로는 import 시점에 조립된다. `when` 중첩 같은 조립 오류는 부팅을 죽이므로(`customers/withdraw-customer.ts`)
// 여기서 조립이 끝나는지, 스텝이 «잠금 → 계획 → 만들기·고치기·지우기(Medusa 예약 워크플로) → 해제» 순인지 본다.
describe('setLineItemReservationsWorkflow 조립', () => {
  it('잠금 안에서 계획하고 Medusa 예약 워크플로로만 쓴다', () => {
    const flow = JSON.stringify(setLineItemReservationsWorkflow().getFlow());
    const actions = (flow.match(/"action":"[^"]+"/g) ?? []).map((a) => a.slice('"action":"'.length, -1));
    expect(actions).toEqual([
      'acquire-lock-step',
      'plan-line-item-reservations',
      'create-reservations-workflow-as-step',
      'update-reservations-workflow-as-step',
      'delete-reservations-as-step',
      'release-lock-step',
    ]);
  });
});
