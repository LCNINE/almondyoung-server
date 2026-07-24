import { Injectable, Logger } from '@nestjs/common';

/**
 * Wallet → Core 조회 클라이언트 (환불신청 가드 전용).
 * 무통장 환불신청을 받기 전에 "이 주문에 이미 다운로드한 디지털 상품이 있는지" 를 Core 에 묻는다.
 */
@Injectable()
export class CoreDigitalGuardClient {
  private readonly logger = new Logger(CoreDigitalGuardClient.name);
  private readonly baseUrl = process.env.CORE_BASE_URL;

  /** @param accessToken WalletAuthGuard 가 검증한 고객 토큰(`request.jwtToken`) */
  async hasExercisedDigital(intentId: string, accessToken?: string): Promise<boolean> {
    if (!this.baseUrl || !accessToken) {
      this.logger.warn(
        `[CoreDigitalGuard] CORE_BASE_URL 미설정 또는 토큰 없음 — 디지털 가드 skip (intent=${intentId})`,
      );
      return false;
    }

    try {
      const res = await fetch(
        `${this.baseUrl}/store/orders/by-wallet-intent/${encodeURIComponent(intentId)}/digital-exercised`,
        { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(5000) },
      );
      if (!res.ok) {
        this.logger.warn(`[CoreDigitalGuard] Core ${res.status} — 가드 skip (intent=${intentId})`);
        return false;
      }
      const body = (await res.json()) as { hasExercisedDigital?: boolean };
      return body.hasExercisedDigital === true;
    } catch (e) {
      this.logger.warn(`[CoreDigitalGuard] Core 호출 실패 — 가드 skip (intent=${intentId}): ${String(e)}`);
      return false;
    }
  }
}
