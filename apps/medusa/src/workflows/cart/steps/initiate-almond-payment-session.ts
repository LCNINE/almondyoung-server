import { createStep } from '@medusajs/framework/workflows-sdk';
import { Logger } from '@medusajs/types';
import { ContainerRegistrationKeys } from '@medusajs/utils';
import { randomUUID } from 'crypto';
import { StepResponse } from '@medusajs/workflows-sdk';

export const initiateAlmondPaymentSessionStepId =
  'initiate-almond-payment-session';

type InitiateAlmondPaymentSessionInput = {
  cart: {
    id: string;
    total: number;
    items: any[];
  };
  payment_collection: {
    id: string;
    amount: number;
  };
};

/**
 * 아몬드 Payment Session 생성
 */
export const initiateAlmondPaymentSessionStep = createStep(
  initiateAlmondPaymentSessionStepId,
  async (
    { cart, payment_collection }: InitiateAlmondPaymentSessionInput,
    { container },
  ) => {
    const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER);

    // 결제 세션 생성에 필요한 데이터 준비
    const sessionData = {
      cart_id: cart.id,
      amount: payment_collection?.amount || cart.total,
      session_id: `ps_${randomUUID()}`,
      payment_url: `https://payment.almond.com/session/${cart.id}`, // 실제 결제 URL로 변경 필요
    };

    logger.info(`Initiating Almond payment session: ${sessionData}`);

    return new StepResponse(sessionData);
  },
);
