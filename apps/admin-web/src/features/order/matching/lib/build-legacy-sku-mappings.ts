import type { MatchingLinkInputDto, SkuMappingDto } from '@/lib/types/dto/matching';

/**
 * 배포 순서 안전장치 (I-1). 새 admin-web 이 옛 core 보다 먼저 뜨면, 옛 core 의
 * `ResolveMatchingDto` 에는 `links` 필드가 없어서 전역 `ValidationPipe`(whitelist: true)가
 * 그걸 에러 없이 지운다 — 그러면 「수동 SKU 구성 매칭」(오늘 잘 도는 경로)이 400 이 된다.
 *
 * 기존 SKU 참조(`skuId`)만 추려 `skuMappings` 로 같이 실어 보내면, 옛 core 는 그것을 쓰고
 * 새 core 는 `links` 를 우선한다(그 우선순위를 지키는 테스트가 core 쪽에 있다:
 * `product-matching.service.spec.ts` 의 'prefers links over the deprecated skuMappings input').
 *
 * `newSku` 만 있는 링크(auto 탭)는 옛 core 에서 애초에 존재하지 않는 개념이라 걸러진다 —
 * auto 탭은 옛 core 에서는 원래도 불가능했으므로(404) 이 폴백이 그걸 되살리지 않는다.
 */
export function buildLegacySkuMappings(
  links: MatchingLinkInputDto[]
): Pick<SkuMappingDto, 'skuId' | 'quantity'>[] {
  return links.flatMap((link) =>
    link.skuId ? [{ skuId: link.skuId, quantity: link.quantity ?? 1 }] : []
  );
}
