import { approveNicepay } from '@/lib/wallet-api';
import { buildReturnUrl } from '@/lib/return-url';

/**
 * NicePay 서버승인 콜백 엔드포인트.
 *
 * NicePay JS SDK(AUTHNICE.requestPay)는 인증 완료 후 이 URL로 form POST 합니다.
 * 서버가 서명을 검증하고 승인 API를 호출한 뒤 결과에 따라 리다이렉트합니다.
 *
 * Query params:
 *   - intentId: wallet payment intent ID (returnUrl에 포함시켜 전달)
 *
 * NicePay POST form fields:
 *   - resultCode, resultMsg, tid, orderId, amount, ediDate, signature
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const intentId = url.searchParams.get('intentId');
  const origin = url.origin;

  if (!intentId) {
    return Response.redirect(new URL('/', origin));
  }

  const failBase = `${origin}/pay/${intentId}?nicepay_fail=1`;

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return Response.redirect(failBase);
  }

  const resultCode = (formData.get('authResultCode') ?? formData.get('resultCode')) as string | null;
  const resultMsg = (formData.get('authResultMsg') ?? formData.get('resultMsg')) as string | null;
  const tid = formData.get('tid') as string | null;
  const orderId = formData.get('orderId') as string | null;
  const rawAmount = formData.get('amount');
  const amount = rawAmount ? Number(rawAmount) : NaN;
  const ediDate = (formData.get('ediDate') as string | null) ?? '';
  const signature = formData.get('signature') as string | null;

  // 인증 단계 실패
  if (resultCode !== '0000') {
    const msg = encodeURIComponent(resultMsg ?? '결제 인증에 실패했습니다.');
    const code = encodeURIComponent(resultCode ?? 'UNKNOWN');
    return Response.redirect(`${failBase}&msg=${msg}&code=${code}`);
  }

  if (!tid || !orderId || isNaN(amount) || !signature) {
    return Response.redirect(failBase);
  }

  try {
    const result = await approveNicepay(intentId, tid, orderId, amount, ediDate, signature);

    if (result.returnUrl) {
      return Response.redirect(
        buildReturnUrl(result.returnUrl, {
          payment_intent_id: intentId,
          status: 'succeeded',
        }),
      );
    }

    return Response.redirect(`${origin}/pay/${intentId}`);
  } catch {
    const msg = encodeURIComponent('승인 처리 중 오류가 발생했습니다.');
    return Response.redirect(`${failBase}&msg=${msg}`);
  }
}
