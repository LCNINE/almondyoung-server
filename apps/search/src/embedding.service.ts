import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EMBEDDING_MODEL, NAME_VECTOR_DIMENSION } from './types/product-document.type';
import { toEmbeddingText } from './utils/text.utils';

const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';
// 검색어는 반복이 심해 캐시가 API 호출과 지연을 대부분 없앤다.
const QUERY_CACHE_LIMIT = 2000;
const REQUEST_TIMEOUT_MS = 5000;
const BATCH_SIZE = 300;

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly apiKey: string | undefined;
  private readonly queryCache = new Map<string, number[]>();

  constructor(configService: ConfigService) {
    this.apiKey = configService.get<string>('OPENAI_API_KEY');
    if (!this.apiKey) {
      this.logger.warn('OPENAI_API_KEY 없음 — 벡터 검색 없이 키워드 검색만 동작합니다.');
    }
  }

  get enabled(): boolean {
    return Boolean(this.apiKey);
  }

  /** 검색어 임베딩. 실패는 null 로 흡수한다 — 벡터가 없다고 검색이 죽으면 안 된다. */
  async embedQuery(query: string): Promise<number[] | null> {
    const key = query.trim().toLowerCase();
    if (!key || !this.apiKey) {
      return null;
    }

    const cached = this.queryCache.get(key);
    if (cached) {
      return cached;
    }

    try {
      const [vector] = await this.embed([key]);
      if (!vector) {
        return null;
      }
      if (this.queryCache.size >= QUERY_CACHE_LIMIT) {
        const oldest = this.queryCache.keys().next().value;
        if (oldest !== undefined) {
          this.queryCache.delete(oldest);
        }
      }
      this.queryCache.set(key, vector);
      return vector;
    } catch (error) {
      this.logger.warn(`검색어 임베딩 실패 — 키워드 검색만 쓴다: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  /** 상품명 배치 임베딩. 정제를 거쳐 넣는다 — 색인과 검색이 같은 규칙을 타야 한다. */
  async embedProductNames(products: Array<{ name: string; brand: string | null }>): Promise<number[][]> {
    return this.embedBatch(products.map((product) => toEmbeddingText(product.name, product.brand)));
  }

  /** 색인용 배치. 여기서는 실패를 흡수하지 않는다 — 조용히 빈 벡터가 들어가면 원인을 못 찾는다. */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY 가 없어 임베딩을 만들 수 없습니다.');
    }

    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      out.push(...(await this.embed(texts.slice(i, i + BATCH_SIZE))));
    }
    return out;
  }

  private async embed(input: string[]): Promise<number[][]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(OPENAI_EMBEDDINGS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input,
          dimensions: NAME_VECTOR_DIMENSION,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`OpenAI ${response.status}: ${(await response.text()).slice(0, 200)}`);
      }

      const body = (await response.json()) as { data: Array<{ index: number; embedding: number[] }> };
      // 순서는 보장된다지만 index 로 다시 세우는 편이 싸다.
      return [...body.data].sort((a, b) => a.index - b.index).map((item) => item.embedding);
    } finally {
      clearTimeout(timer);
    }
  }
}
