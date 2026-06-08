import { UGC_COMMAND_STREAM, UGC_EVENT_STREAM } from '../ugc.stream';

const VALID_PAYLOAD = {
  productId: '550e8400-e29b-41d4-a716-446655440000',
  reviewCount: 42,
  ratingSum: 168,
  averageRating: 4.0,
  bayesianReviewScore: 3.92,
  ratingDistribution: { '1': 1, '2': 2, '3': 5, '4': 15, '5': 19 },
  changedAt: '2026-06-08T12:00:00.000Z',
};

describe('UGC_EVENT_STREAM', () => {
  describe('stream topology', () => {
    it('ugc.events.v1 topic을 사용한다', () => {
      expect(UGC_EVENT_STREAM.topic.topic).toBe('ugc.events.v1');
    });

    it('aggregateType이 UgcProduct이다 (core Product와 구별)', () => {
      expect(UGC_EVENT_STREAM.aggregateType).toBe('UgcProduct');
    });

    it('UGC_COMMAND_STREAM(ugc.commands.v1)과 topic이 다르다', () => {
      expect(UGC_EVENT_STREAM.topic.topic).not.toBe(UGC_COMMAND_STREAM.topic.topic);
    });

    it('ProductReviewStatsChanged 이벤트가 등록되어 있다', () => {
      expect(UGC_EVENT_STREAM.events.ProductReviewStatsChanged).toBeDefined();
      expect(UGC_EVENT_STREAM.events.ProductReviewStatsChanged.messageType).toBe(
        'ProductReviewStatsChanged',
      );
    });

    it('schema가 존재한다 (런타임 검증 가능)', () => {
      expect(UGC_EVENT_STREAM.events.ProductReviewStatsChanged.schema).toBeDefined();
    });
  });

  describe('ProductReviewStatsChanged schema validation', () => {
    const schema = UGC_EVENT_STREAM.events.ProductReviewStatsChanged.schema!;

    it('유효한 payload를 통과시킨다', () => {
      expect(() => schema.parse(VALID_PAYLOAD)).not.toThrow();
    });

    it('parse 결과가 입력과 동일한 값을 가진다', () => {
      const result = schema.parse(VALID_PAYLOAD);
      expect(result.productId).toBe(VALID_PAYLOAD.productId);
      expect(result.reviewCount).toBe(42);
      expect(result.bayesianReviewScore).toBe(3.92);
    });

    describe('productId', () => {
      it('UUID가 아닌 값을 거부한다', () => {
        expect(() => schema.parse({ ...VALID_PAYLOAD, productId: 'not-a-uuid' })).toThrow();
      });

      it('빈 문자열을 거부한다', () => {
        expect(() => schema.parse({ ...VALID_PAYLOAD, productId: '' })).toThrow();
      });
    });

    describe('reviewCount', () => {
      it('0을 허용한다 (리뷰가 없는 상품)', () => {
        expect(() =>
          schema.parse({
            ...VALID_PAYLOAD,
            reviewCount: 0,
            ratingSum: 0,
            averageRating: 0,
            bayesianReviewScore: 3.5,
            ratingDistribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
          }),
        ).not.toThrow();
      });

      it('음수를 거부한다', () => {
        expect(() => schema.parse({ ...VALID_PAYLOAD, reviewCount: -1 })).toThrow();
      });

      it('소수를 거부한다', () => {
        expect(() => schema.parse({ ...VALID_PAYLOAD, reviewCount: 1.5 })).toThrow();
      });
    });

    describe('ratingSum', () => {
      it('음수를 거부한다', () => {
        expect(() => schema.parse({ ...VALID_PAYLOAD, ratingSum: -10 })).toThrow();
      });

      it('소수를 거부한다', () => {
        expect(() => schema.parse({ ...VALID_PAYLOAD, ratingSum: 10.5 })).toThrow();
      });
    });

    describe('averageRating', () => {
      it('0.0을 허용한다', () => {
        expect(() =>
          schema.parse({
            ...VALID_PAYLOAD,
            reviewCount: 0,
            ratingSum: 0,
            averageRating: 0,
            ratingDistribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
          }),
        ).not.toThrow();
      });

      it('5.0을 허용한다', () => {
        expect(() => schema.parse({ ...VALID_PAYLOAD, averageRating: 5.0 })).not.toThrow();
      });

      it('5.0 초과를 거부한다', () => {
        expect(() => schema.parse({ ...VALID_PAYLOAD, averageRating: 5.01 })).toThrow();
      });

      it('음수를 거부한다', () => {
        expect(() => schema.parse({ ...VALID_PAYLOAD, averageRating: -0.1 })).toThrow();
      });
    });

    describe('bayesianReviewScore', () => {
      it('0.0을 허용한다 (리뷰 없음 시 prior mean에 수렴하지 않는 극단값)', () => {
        expect(() => schema.parse({ ...VALID_PAYLOAD, bayesianReviewScore: 0 })).not.toThrow();
      });

      it('5.0을 허용한다', () => {
        expect(() => schema.parse({ ...VALID_PAYLOAD, bayesianReviewScore: 5.0 })).not.toThrow();
      });

      it('5.0 초과를 거부한다', () => {
        expect(() => schema.parse({ ...VALID_PAYLOAD, bayesianReviewScore: 5.01 })).toThrow();
      });

      it('음수를 거부한다', () => {
        expect(() => schema.parse({ ...VALID_PAYLOAD, bayesianReviewScore: -0.01 })).toThrow();
      });
    });

    describe('ratingDistribution', () => {
      it('키가 하나라도 빠지면 거부한다', () => {
        const { '5': _omit, ...incomplete } = VALID_PAYLOAD.ratingDistribution;
        expect(() =>
          schema.parse({ ...VALID_PAYLOAD, ratingDistribution: incomplete }),
        ).toThrow();
      });

      it('값이 음수이면 거부한다', () => {
        expect(() =>
          schema.parse({
            ...VALID_PAYLOAD,
            ratingDistribution: { ...VALID_PAYLOAD.ratingDistribution, '1': -1 },
          }),
        ).toThrow();
      });

      it('값이 소수이면 거부한다', () => {
        expect(() =>
          schema.parse({
            ...VALID_PAYLOAD,
            ratingDistribution: { ...VALID_PAYLOAD.ratingDistribution, '3': 2.5 },
          }),
        ).toThrow();
      });

      it('모든 값이 0인 경우를 허용한다', () => {
        expect(() =>
          schema.parse({
            ...VALID_PAYLOAD,
            reviewCount: 0,
            ratingSum: 0,
            averageRating: 0,
            ratingDistribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
          }),
        ).not.toThrow();
      });
    });

    describe('changedAt', () => {
      it('ISO-8601 datetime을 허용한다', () => {
        expect(() =>
          schema.parse({ ...VALID_PAYLOAD, changedAt: '2026-06-08T00:00:00.000Z' }),
        ).not.toThrow();
      });

      it('날짜만 있는 형식을 거부한다', () => {
        expect(() => schema.parse({ ...VALID_PAYLOAD, changedAt: '2026-06-08' })).toThrow();
      });

      it('슬래시 구분자 형식을 거부한다', () => {
        expect(() =>
          schema.parse({ ...VALID_PAYLOAD, changedAt: '2026/06/08 12:00:00' }),
        ).toThrow();
      });

      it('빈 문자열을 거부한다', () => {
        expect(() => schema.parse({ ...VALID_PAYLOAD, changedAt: '' })).toThrow();
      });
    });
  });
});
