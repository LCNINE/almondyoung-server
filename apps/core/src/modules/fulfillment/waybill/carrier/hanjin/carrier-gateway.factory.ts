import { loadHanjinConfig, type HanjinConfig } from './hanjin.config';
import { HanjinHmacSigner } from './hanjin-hmac.signer';
import { HanjinApiClient } from './hanjin-api.client';
import { HanjinCarrierGateway } from './hanjin-carrier.gateway';
import { CarrierGatewayRegistry } from '../carrier-gateway.registry';

// 플랜 1 캐리어 클래스들(HanjinHmacSigner/HanjinApiClient/HanjinCarrierGateway)은 @Injectable 이 아니므로
// Nest DI 가 직접 생성할 수 없다 — 이 팩토리가 useFactory 프로바이더로 수동 생성한다.

export function buildHanjinConfig(): HanjinConfig {
  return loadHanjinConfig(process.env);
}

export function buildCarrierGatewayRegistry(config: HanjinConfig): CarrierGatewayRegistry {
  const signer = new HanjinHmacSigner({
    clientId: config.clientId,
    apiKey: config.apiKey,
    secretKey: config.secretKey,
  });
  const client = new HanjinApiClient(config, signer);
  const hanjin = new HanjinCarrierGateway(config, client);
  return new CarrierGatewayRegistry([hanjin]);
}
