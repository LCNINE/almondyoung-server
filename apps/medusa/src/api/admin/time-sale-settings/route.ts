import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { loadTimeSaleSettings, saveTimeSaleSettings } from '../../../utils/time-sale-settings';

// 진열·스타일 설정과 현재 revision 조회.
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  return res.json(await loadTimeSaleSettings(req.scope));
}

// 진열·스타일 설정 저장(revision 이 어긋나면 409).
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = req.body as { settings?: unknown; revision?: unknown };

  return res.json(await saveTimeSaleSettings(req.scope, body?.settings, body?.revision));
}
