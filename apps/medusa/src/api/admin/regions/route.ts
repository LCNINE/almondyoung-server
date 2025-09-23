import { MedusaRequest, MedusaResponse } from '@medusajs/framework/http';
import { Modules } from '@medusajs/framework/utils';
import { CreateRegionDTO } from '@medusajs/types';

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const regionService = req.scope.resolve(Modules.REGION);
  const [regions, count] = await regionService.listAndCountRegions();

  res.json({ regions, count });
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const regionService = req.scope.resolve(Modules.REGION);
    const region = await regionService.createRegions(
      req.validatedBody as CreateRegionDTO,
    );

    res.json({ region });
  } catch (error) {
    res.status(400).json({
      message: '리전 생성 중 오류가 발생했습니다.',
      error: error instanceof Error ? error.message : '알 수 없는 오류',
    });
  }
}
