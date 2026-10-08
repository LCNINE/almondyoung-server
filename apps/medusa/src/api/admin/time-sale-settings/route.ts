import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { loadTimeSaleSettings } from '../../../utils/time-sale-settings';
import { saveTimeSaleSettingsFromAdmin } from '../../../workflows/time-sale/save-time-sale-settings';

// 세일 환경 설정과 현재 revision 조회.
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  return res.json(await loadTimeSaleSettings(req.scope));
}

// 세일 환경 설정 저장(revision 이 어긋나면 409).
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = req.body as { settings?: unknown; revision?: unknown };

  return res.json(await saveTimeSaleSettingsFromAdmin(req.scope, body?.settings, body?.revision));
}
