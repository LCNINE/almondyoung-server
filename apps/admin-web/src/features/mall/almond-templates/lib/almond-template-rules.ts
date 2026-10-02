import type {
  AdminAlmondTemplateDto,
  AlmondTemplateStatus,
} from '@/lib/types/dto/products';

export type AlmondTemplateTab = AlmondTemplateStatus | 'all';

export const ALMOND_TEMPLATE_KIND_LABELS: Record<string, string> = {
  pet: 'PET 입간판·X배너',
  mini: '테이블 미니배너',
  card: '시술 후 주의사항 카드',
  window: '유리창 부착 현수막',
  menu: '메뉴판·가격표',
  diploma: '디플로마·수료증',
  nail: '네일팁 종이',
};

export const ALMOND_TEMPLATE_STATUS_LABELS: Record<
  AlmondTemplateStatus,
  string
> = {
  draft: '초안',
  published: '게시중',
};

export const ALMOND_TEMPLATE_STATUS_TABS: readonly {
  value: AlmondTemplateTab;
  label: string;
}[] = [
  { value: 'all', label: '전체' },
  { value: 'draft', label: '초안' },
  { value: 'published', label: '게시중' },
];

export const KIND_FILTER_ALL = 'all';
export const KIND_FILTER_NONE = 'none';

export function almondTemplateKindLabel(kind: string | null): string {
  if (!kind) return '미지정';
  return ALMOND_TEMPLATE_KIND_LABELS[kind] ?? kind;
}

export function countByTab(
  templates: readonly AdminAlmondTemplateDto[]
): Record<AlmondTemplateTab, number> {
  return {
    all: templates.length,
    draft: templates.filter((t) => t.status === 'draft').length,
    published: templates.filter((t) => t.status === 'published').length,
  };
}

export function kindFilterOptions(
  templates: readonly AdminAlmondTemplateDto[]
): { value: string; label: string }[] {
  const known = Object.keys(ALMOND_TEMPLATE_KIND_LABELS);
  const extra = [
    ...new Set(
      templates
        .map((t) => t.kind)
        .filter((k): k is string => !!k && !known.includes(k))
    ),
  ];
  const options = [...known, ...extra].map((value) => ({
    value,
    label: almondTemplateKindLabel(value),
  }));
  if (templates.some((t) => !t.kind))
    options.push({ value: KIND_FILTER_NONE, label: '미지정' });
  return options;
}

export function filterAlmondTemplates(
  templates: readonly AdminAlmondTemplateDto[],
  filter: { tab: AlmondTemplateTab; kind: string; q: string }
): AdminAlmondTemplateDto[] {
  const q = filter.q.trim().toLowerCase();
  return templates.filter((t) => {
    if (filter.tab !== 'all' && t.status !== filter.tab) return false;
    if (filter.kind === KIND_FILTER_NONE && t.kind) return false;
    if (
      filter.kind !== KIND_FILTER_ALL &&
      filter.kind !== KIND_FILTER_NONE &&
      t.kind !== filter.kind
    )
      return false;
    if (q && !t.title.toLowerCase().includes(q)) return false;
    return true;
  });
}

export function almondTemplateEditorUrl(
  storefrontUrl: string,
  country: string,
  templateId?: string
): string | null {
  const base = storefrontUrl.replace(/\/+$/, '');
  if (!base) return null;
  const params = new URLSearchParams({ mode: 'designer' });
  if (templateId) params.set('template', templateId);
  return `${base}/${country}/almond-template?${params.toString()}`;
}
