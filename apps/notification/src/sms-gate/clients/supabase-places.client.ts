import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableError, UpstreamUnavailableError } from '@app/shared';

// 크롤러 data lake 의 정규화 테이블. raw_places 를 place_id 별 최신 성공분으로 합친 것이라 이쪽만 본다.
const CANONICAL_TABLE = 'canonical_places';
// PostgREST 가 한 번에 돌려주는 최대 행 수. 이보다 적게 오면 마지막 페이지다.
const PAGE_SIZE = 1000;
const REQUEST_TIMEOUT_MS = 20_000;

export interface CanonicalPlace {
  place_id: string;
  shop_name: string | null;
  phone: string | null;
}

@Injectable()
export class SupabasePlacesClient {
  constructor(private readonly configService: ConfigService) {}

  async fetchPlaces(category: string): Promise<CanonicalPlace[]> {
    const url = this.configService.get<string>('SUPABASE_PLACES_URL');
    const key = this.configService.get<string>('SUPABASE_PLACES_SERVICE_KEY');
    if (!url || !key) throw new ServiceUnavailableError('Supabase 연결 정보가 설정되지 않았습니다');

    const places: CanonicalPlace[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      // offset 페이지네이션은 정렬이 고정돼야 행이 밀리거나 겹치지 않는다.
      const query = new URLSearchParams({
        select: 'place_id,shop_name,phone',
        category: `eq.${category}`,
        order: 'place_id',
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      const response = await fetch(`${url}/rest/v1/${CANONICAL_TABLE}?${query.toString()}`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new UpstreamUnavailableError(`Supabase 조회 실패 ${response.status}: ${await response.text()}`);
      }
      const page = (await response.json()) as CanonicalPlace[];
      places.push(...page);
      if (page.length < PAGE_SIZE) return places;
    }
  }
}
