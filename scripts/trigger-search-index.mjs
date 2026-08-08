/**
 * Trigger search re-indexing for TAT FILM GEL by publishing a Kafka event
 */
import { Kafka } from 'kafkajs';
import { ulid } from 'ulid';
import { readFileSync } from 'fs';

const KAFKA_BROKERS = 'pkc-e82om.ap-northeast-2.aws.confluent.cloud:9092';
const KAFKA_API_KEY = 'IGRBCGCKUO2NDECP';
const KAFKA_API_SECRET = 'cflt4wduGB+fA/ZV88Bhhm2Vx1OcvRNZSB4PoIcW4WKAUbuNs1aPIe92kn8EDzMg';
const TOPIC = 'products.events.v1';

const MASTER_ID = '019cdb2b-ab0d-72a9-b9e9-d790ab99df77';
const VERSION_ID = '019cdb2b-ab0d-72a9-b9e9-da808a815381';
const FILE_SERVICE_URL = 'https://file.almondyoung-next.com';

// Build snapshot from PIM API response
const pimData = JSON.parse(readFileSync('/tmp/tat-film-gel.json', 'utf8'));

// Get category IDs from PIM categories endpoint
const categoriesResp = await fetch(`https://pim.almondyoung-next.com/masters/${MASTER_ID}`);
const masterData = await categoriesResp.json();

// Fetch category details via PIM API
const optionGroupMap = new Map(
  (pimData.optionGroups || []).map(g => [g.id, g.displayName || g.name])
);

const snapshot = {
  masterId: MASTER_ID,
  versionId: VERSION_ID,
  version: pimData.version || 1,
  name: pimData.name,
  description: pimData.description || undefined,
  descriptionHtml: pimData.descriptionHtml || undefined,
  thumbnail: pimData.thumbnail
    ? `${FILE_SERVICE_URL}/files/${pimData.thumbnail}`
    : undefined,
  images: (pimData.images || []).map(img => ({
    fileId: img.fileId,
    url: `${FILE_SERVICE_URL}/files/${img.fileId}`,
    isPrimary: img.isPrimary ?? false,
    sortOrder: img.sortOrder ?? 0,
  })),
  brand: pimData.brand || undefined,
  tags: (pimData.tagValues || []).map(tv => tv.name),
  optionGroups: (pimData.optionGroups || []).map(g => ({
    id: g.id,
    name: g.displayName || g.name,
    values: (g.values || []).map(v => ({
      id: v.id,
      name: v.displayName || v.name,
      colorCode: v.colorCode,
      imageUrl: v.imageUrl,
    })),
  })),
  variants: (pimData.variants || []).map(v => ({
    id: v.id,
    variantName: v.variantName || '',
    sku: v.sku || '',
    variantCode: v.variantCode,
    isDefault: v.isDefault || false,
    status: v.status || 'active',
    optionCombination: (v.optionValues || []).map(ov => ({
      name: ov.optionGroupName || optionGroupMap.get(ov.optionGroupId) || 'Unknown',
      value: ov.displayName || ov.name,
    })),
    basePrice: v.priceSet?.basePrice ?? v.price ?? 30000,
    membershipPrice: v.priceSet?.membershipPrice,
    tieredPrices: v.priceSet?.tieredPrices ?? [],
  })),
  status: pimData.status || 'active',
  isWholesaleOnly: pimData.isWholesaleOnly || false,
  isMembershipOnly: pimData.isMembershipOnly || false,
  isGiftcard: pimData.isGiftcard || false,
  discountable: pimData.discountable !== false,
};

console.log('Snapshot built:', JSON.stringify(snapshot, null, 2));

const now = new Date().toISOString();
const messageId = ulid();
const correlationId = ulid();

const envelope = {
  messageId,
  messageType: 'ProductMasterActiveVersionChanged',
  messageVersion: 1,
  messageKind: 'event',
  correlationId,
  timestamp: now,
  occurredAt: now,
  source: {
    service: 'pim',
    aggregateType: 'Product',
    aggregateId: MASTER_ID,
  },
  payload: {
    masterId: MASTER_ID,
    versionId: VERSION_ID,
    name: pimData.name,
    previousActiveVersionId: null,
    categoryIds: [],
    primaryCategoryId: null,
    changeReason: 'published',
    changedAt: now,
    snapshot,
  },
};

console.log('\nPublishing event to Kafka...');
console.log('Topic:', TOPIC);
console.log('MessageId:', messageId);

const kafka = new Kafka({
  clientId: 'manual-reindex',
  brokers: [KAFKA_BROKERS],
  ssl: true,
  sasl: {
    mechanism: 'plain',
    username: KAFKA_API_KEY,
    password: KAFKA_API_SECRET,
  },
});

const producer = kafka.producer();
await producer.connect();

await producer.send({
  topic: TOPIC,
  messages: [
    {
      key: MASTER_ID,
      value: JSON.stringify(envelope),
    },
  ],
});

await producer.disconnect();
console.log('✅ Kafka event published successfully!');
console.log('The search service should index the product shortly.');
