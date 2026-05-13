import { ALMONDYOUNG_API_BASE_URL } from '@/const/api-const';
import { client } from '../client';

// health-check 는 인증이 필요 없지만, 다른 도메인 client 와 동일한 axios 인스턴스를 쓰도록 통일.
// envelope auto-unwrap / retry 등 공통 처리도 그대로 적용된다.
export async function getInventoryHealth() {
  const { data } = await client.get(`${ALMONDYOUNG_API_BASE_URL}/inventory/health`);
  return data;
}
