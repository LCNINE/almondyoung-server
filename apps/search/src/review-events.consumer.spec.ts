import { Test, TestingModule } from '@nestjs/testing';
import { ReviewEventsConsumer } from './review-events.consumer';
import { ProductIndexService } from './product-index.service';

const PRODUCT_ID = '550e8400-e29b-41d4-a716-446655440001';
const MESSAGE_ID = 'msg-001';

function makeEnvelope(payload: object) {
  return {
    messageId: MESSAGE_ID,
    messageType: 'ProductReviewStatsChanged',
    payload,
  } as any;
}

function makePayload(overrides: Partial<{
  productId: string;
  reviewCount: number;
  ratingSum: number;
  averageRating: number;
  bayesianReviewScore: number;
  ratingDistribution: object;
  changedAt: string;
}> = {}) {
  return {
    productId: PRODUCT_ID,
    reviewCount: 10,
    ratingSum: 42,
    averageRating: 4.2,
    bayesianReviewScore: 3.97,
    ratingDistribution: { '1': 0, '2': 1, '3': 1, '4': 3, '5': 5 },
    changedAt: '2026-06-08T00:00:00.000Z',
    ...overrides,
  };
}

describe('ReviewEventsConsumer', () => {
  let consumer: ReviewEventsConsumer;
  let productIndexService: jest.Mocked<ProductIndexService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReviewEventsConsumer],
      providers: [
        {
          provide: ProductIndexService,
          useValue: {
            updateProductReviewStats: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    consumer = module.get(ReviewEventsConsumer);
    productIndexService = module.get(ProductIndexService);
  });

  it('calls updateProductReviewStats with mapped fields', async () => {
    const payload = makePayload();
    await consumer.onProductReviewStatsChanged(makeEnvelope(payload), payload);

    expect(productIndexService.updateProductReviewStats).toHaveBeenCalledWith(PRODUCT_ID, {
      review_count: 10,
      average_rating: 4.2,
      bayesian_review_score: 3.97,
      review_stats_updated_at: '2026-06-08T00:00:00.000Z',
    });
  });

  it('resolves successfully when product is not in index (warn + skip)', async () => {
    // updateProductReviewStats logs warn and returns undefined for 404
    productIndexService.updateProductReviewStats.mockResolvedValue(undefined);
    await expect(
      consumer.onProductReviewStatsChanged(makeEnvelope(makePayload()), makePayload()),
    ).resolves.toBeUndefined();
  });

  it('rethrows on unexpected error (triggers DLQ)', async () => {
    const err = new Error('OpenSearch connection refused');
    productIndexService.updateProductReviewStats.mockRejectedValue(err);

    await expect(
      consumer.onProductReviewStatsChanged(makeEnvelope(makePayload()), makePayload()),
    ).rejects.toThrow('OpenSearch connection refused');
  });

  it('passes zero-review payload correctly', async () => {
    const payload = makePayload({
      reviewCount: 0,
      ratingSum: 0,
      averageRating: 0,
      bayesianReviewScore: 3.5,
    });
    await consumer.onProductReviewStatsChanged(makeEnvelope(payload), payload);

    expect(productIndexService.updateProductReviewStats).toHaveBeenCalledWith(PRODUCT_ID, {
      review_count: 0,
      average_rating: 0,
      bayesian_review_score: 3.5,
      review_stats_updated_at: '2026-06-08T00:00:00.000Z',
    });
  });
});
