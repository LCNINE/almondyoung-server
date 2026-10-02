import { type AlmondTemplateEntity } from '../types/almond-template.types';
import { AlmondTemplateMapper } from './almond-template.mapper';

function entity(design: Record<string, unknown>): AlmondTemplateEntity {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    productId: '22222222-2222-4222-8222-222222222222',
    widthMm: 600,
    heightMm: 1800,
    title: '봄 이벤트',
    industry: '미용·뷰티',
    purpose: '이벤트·홍보',
    colors: ['#ffffff'],
    design,
    thumbnailSvg: '<svg></svg>',
    status: 'draft',
    createdBy: '33333333-3333-4333-8333-333333333333',
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-02T00:00:00Z'),
  };
}

describe('AlmondTemplateMapper 관리자 요약의 kind', () => {
  it('design.kind 문자열을 그대로 싣는다', () => {
    expect(AlmondTemplateMapper.toAdminSummaryFromEntity(entity({ kind: 'pet' })).kind).toBe('pet');
  });

  it('없거나 문자열이 아니면 null 이다', () => {
    expect(AlmondTemplateMapper.toAdminSummaryFromEntity(entity({})).kind).toBeNull();
    expect(AlmondTemplateMapper.toAdminSummaryFromEntity(entity({ kind: 3 })).kind).toBeNull();
  });

  it('상세에도 kind 가 실린다', () => {
    expect(AlmondTemplateMapper.toAdminDetail(entity({ kind: 'menu' })).kind).toBe('menu');
  });
});
