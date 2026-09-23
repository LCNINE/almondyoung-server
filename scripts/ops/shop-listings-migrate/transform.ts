import { htmlToMarkdown } from './html-to-markdown';

/** core `shop_listings` 한 행 (postgres.js 가 돌려주는 snake_case 그대로). */
export interface CoreShopListingRow {
  id: string;
  slug: string;
  title: string;
  content: string;
  region: string | null;
  business_type: string | null;
  deal_type: string | null;
  area_pyeong: number | null;
  deposit: number | null;
  monthly_rent: number | null;
  key_money: number | null;
  thumbnail_file_id: string | null;
  images: string[] | null;
  is_active: boolean;
  view_count: number;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  updated_by: string | null;
}

/** ugc `shop_listings` 에 넣을 한 행. */
export interface UgcListingRow {
  id: string;
  slug: string;
  title: string;
  content: string;
  region: string | null;
  business_type: string | null;
  deal_type: string | null;
  area_pyeong: number | null;
  deposit: number | null;
  monthly_rent: number | null;
  key_money: number | null;
  contact_phone: null;
  kakao_open_chat_url: null;
  author_type: 'admin';
  author_user_id: string | null;
  status: 'published' | 'hidden';
  view_count: number;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export function transformListing(row: CoreShopListingRow): { listing: UgcListingRow; imageFileIds: string[] } {
  return {
    listing: {
      id: row.id,
      slug: row.slug,
      title: row.title,
      content: htmlToMarkdown(row.content),
      region: row.region,
      business_type: row.business_type,
      deal_type: row.deal_type,
      area_pyeong: row.area_pyeong,
      deposit: row.deposit,
      monthly_rent: row.monthly_rent,
      key_money: row.key_money,
      contact_phone: null,
      kakao_open_chat_url: null,
      author_type: 'admin',
      author_user_id: row.created_by,
      status: row.is_active ? 'published' : 'hidden',
      view_count: row.view_count,
      updated_by: row.updated_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
    imageFileIds: orderImages(row.thumbnail_file_id, row.images ?? []),
  };
}

/** 썸네일이 곧 order 0 이다. core 는 썸네일을 따로 들고 있었으므로 앞으로 옮긴다. */
function orderImages(thumbnail: string | null, images: string[]): string[] {
  const ordered = thumbnail ? [thumbnail, ...images] : images;
  return [...new Set(ordered)];
}

/** 한 INSERT 의 파라미터가 postgres.js 상한(65,534)을 넘지 않게 행을 나눈다. */
export function chunk<T>(rows: T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error(`chunk size 는 1 이상의 정수여야 한다: ${size}`);
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
