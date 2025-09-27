// import {
//   createWorkflow,
//   WorkflowData,
//   WorkflowResponse,
// } from '@medusajs/framework/workflows-sdk';
// import {
//   acquireLockStep,
//   useQueryGraphStep,
//   useRemoteQueryStep,
//   releaseLockStep,
// } from '@medusajs/medusa/core-flows';
// import { completeCartFields } from '../utils/fields';
// import { initiateAlmondPaymentSessionStep } from '../steps/initiate-almond-payment-session';

// const THREE_DAYS = 60 * 60 * 24 * 3;
// const THIRTY_SECONDS = 30;
// const TWO_MINUTES = 60 * 2;

// export const almondInitiateCartWorkflowId = 'almond-initiate-cart';

// export const almondInitiateCartWorkflow = createWorkflow(
//   almondInitiateCartWorkflowId,
//   (input: WorkflowData<{ cart_id: string }>) => {
//     // 동시성 제어 (같은 아이디로 다중 요청 방지)
//     acquireLockStep({
//       key: input.cart_id,
//       timeout: THIRTY_SECONDS,
//       ttl: TWO_MINUTES,
//     });

//     // 기존 주문 체크 (중복 주문 방지)
//     const orderCart = useQueryGraphStep({
//       entity: 'order_cart',
//       fields: ['cart_id', 'order_id'],
//       filters: { cart_id: input.cart_id },
//     });

//     // cart 전체 데이터 조회
//     const cart = useRemoteQueryStep({
//       entry_point: 'cart',
//       fields: completeCartFields,
//       variables: { id: input.cart_id },
//       list: false,
//     });

//     // Payment Collection 생성/조회
//     // 이부분은 프론트에서 sdk로 결제 세션 초기화로 payment_collection이랑 payment_session이 초기화될거라 뺴도될거같아서 뻇음
//     const paymentCollection = createOrRetrievePaymentCollectionStep({ cart });

//     // 아몬드 Payment Session 생성
//     const paymentSession = initiateAlmondPaymentSessionStep({
//       payment_collection: paymentCollection,
//       cart: cart,
//     });

//     releaseLockStep({ key: input.cart_id });

//     return new WorkflowResponse({
//       payment_url: paymentSession.payment_url,
//       session_id: paymentSession.id,
//       cart_id: input.cart_id,
//     });
//   },
// );
