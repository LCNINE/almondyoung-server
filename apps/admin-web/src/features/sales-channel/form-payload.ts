import type { CreateChannelDto, UpdateChannelDto } from '@/lib/types/dto/products';
import {
  DEFAULT_CHANNEL_TYPE,
  SALES_CHANNEL_SITE_LABELS,
  type ChannelFormType,
  type SalesChannelSite,
} from '@/lib/api/domains/sales-channel/vocabulary';

export type SalesChannelFormState = {
  /** 채널 정체 — `sales_channels.site` */
  site: string;
  /** 채널 형태 — `sales_channels.type` */
  type: string;
  name: string;
  memo: string;
  feeRate: string;
  smartstoreUrl: string;
  companyCode: string;
  shipperName: string;
  shipperPhone: string;
  shipperZip: string;
  shipperAddress: string;
  isActive: boolean;
};

function isKnownSite(site: string): site is SalesChannelSite {
  return Object.prototype.hasOwnProperty.call(SALES_CHANNEL_SITE_LABELS, site);
}

function resolveType(type: string): ChannelFormType {
  // as: the dropdown only ever writes CHANNEL_TYPE_OPTIONS values into formData.type, so a
  // non-empty string here is already a ChannelFormType — this narrows, it doesn't fabricate.
  return type ? (type as ChannelFormType) : DEFAULT_CHANNEL_TYPE;
}

function buildConfig(form: SalesChannelFormState): Record<string, unknown> {
  const hasShipper =
    Boolean(form.shipperName) ||
    Boolean(form.shipperPhone) ||
    Boolean(form.shipperZip) ||
    Boolean(form.shipperAddress);

  const config: Record<string, unknown> = {};
  if (form.memo) config.memo = form.memo;
  if (form.feeRate) config.feeRate = Number(form.feeRate);
  if (form.site === 'naver' && form.smartstoreUrl) config.smartstoreUrl = form.smartstoreUrl;
  if (form.site === 'coupang' && form.companyCode) config.companyCode = form.companyCode;
  if (hasShipper) {
    config.shipper = {
      name: form.shipperName,
      phone: form.shipperPhone,
      zipcode: form.shipperZip,
      address: form.shipperAddress,
    };
  }
  return config;
}

/** 필수값이 안 찼거나 어휘 밖의 site 면 `null` — 호출자는 제출하지 않는다. */
export function buildCreatePayload(form: SalesChannelFormState): CreateChannelDto | null {
  if (!isKnownSite(form.site)) return null;
  if (!form.name.trim()) return null;

  return {
    site: form.site,
    type: resolveType(form.type),
    name: form.name.trim(),
    config: buildConfig(form),
  };
}

/**
 * `site` 는 싣지 않는다. 채널 정체를 바꾸면 그 채널에 매달린 `channel_variant_listings` 가
 * 조용히 다른 채널의 것이 된다 (`channel-listing.service.ts` 의 `eq(salesChannels.site, ...)`).
 * 정체를 바꿔야 하면 새 채널을 만드는 게 맞다.
 */
export function buildUpdatePayload(form: SalesChannelFormState): UpdateChannelDto {
  return {
    type: resolveType(form.type),
    name: form.name.trim(),
    isActive: form.isActive,
    config: buildConfig(form),
  };
}
