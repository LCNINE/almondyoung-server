import { resolveCouponName } from '../helpers';

/**
 * #789. 「쿠폰 이름」은 스토어 응답 **세 곳**(`customers/me/promotions` · `coupons/preview` ·
 * `events/:slug`)에서 나간다. 세 곳이 각자 `meta?.name` 을 읽으면 trim 규칙이 갈리므로,
 * 판정은 이미 세 라우트가 공유하는 이 helpers 에 둔다 — `resolveVisibility` 와 같은 자리다.
 */
describe('resolveCouponName (#789)', () => {
  it('이름이 있으면 그대로 돌려준다', () => {
    expect(resolveCouponName({ name: '신규 가입 축하 쿠폰' })).toBe('신규 가입 축하 쿠폰');
  });

  it('메타 행 자체가 없으면 null 이다', () => {
    expect(resolveCouponName(null)).toBeNull();
    expect(resolveCouponName(undefined)).toBeNull();
  });

  it('이름 컬럼이 비어 있으면 null 이다 — 선택 입력이라 흔한 경우다', () => {
    expect(resolveCouponName({ visibility: 'public' })).toBeNull();
    expect(resolveCouponName({ name: null })).toBeNull();
  });

  // 🔴 어드민 폼은 자유 입력이라 공백만 들어온 이름이 실재한다. 그걸 그대로 내보내면
  // 화면의 `name ?? code` 폴백이 «참» 으로 걸려서 제목이 **빈 줄**로 나간다 — 코드조차
  // 안 보이는, 지금보다 나쁜 상태다.
  it('공백뿐인 이름은 「없음」으로 접는다', () => {
    expect(resolveCouponName({ name: '   ' })).toBeNull();
    expect(resolveCouponName({ name: '\n\t' })).toBeNull();
  });

  it('앞뒤 공백은 털어낸다', () => {
    expect(resolveCouponName({ name: '  가을 배송비 지원  ' })).toBe('가을 배송비 지원');
  });

  it('문자열이 아닌 값은 null 이다 — 응답에 숫자나 객체가 새지 않게', () => {
    expect(resolveCouponName({ name: 123 })).toBeNull();
    expect(resolveCouponName({ name: { ko: '이름' } })).toBeNull();
  });
});
