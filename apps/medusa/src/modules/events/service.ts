import { Kafka, Producer, Consumer, EachMessagePayload } from 'kafkajs';
import { MedusaService } from '@medusajs/framework/utils';
import { PAYMENT_EVENTS, USER_EVENTS, INVENTORY_STREAM } from '@packages/event-contracts/streams';

type ModuleOptions = {
  kafka: {
    clientId: string;
    brokers: string[];
    groupId: string;
  };
};

export default class EventModuleService extends MedusaService({}) {
  private static instance_: EventModuleService;
  private kafka_: Kafka;
  private producer_: Producer;
  private consumer_: Consumer;
  private isConnected_: boolean = false;
  private options_: ModuleOptions;
  private container_: any;
  private maxRetries_ = 5;
  private retryDelay_ = 5000; // 5초

  constructor(container: any, options: ModuleOptions) {
    super(container);
    this.container_ = container;

    this.options_ = options || {
      kafka: {
        clientId: process.env.KAFKA_CLIENT_ID || 'medusa-service',
        brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
        groupId: process.env.KAFKA_GROUP_ID || 'medusa-consumer',
      },
    };

    if (EventModuleService.instance_) {
      return EventModuleService.instance_;
    }

    this.kafka_ = new Kafka({
      clientId: this.options_.kafka.clientId,
      brokers: this.options_.kafka.brokers,
      retry: {
        initialRetryTime: 1000,
        retries: 8,
      },
    });

    this.producer_ = this.kafka_.producer({
      allowAutoTopicCreation: true,
      retry: {
        initialRetryTime: 1000,
        retries: 8,
      },
    });

    this.consumer_ = this.kafka_.consumer({
      groupId: this.options_.kafka.groupId,
      retry: {
        initialRetryTime: 1000,
        retries: 8,
      },
    });

    this.connect();
    EventModuleService.instance_ = this;
  }

  private async retryConnect_(attempt = 1): Promise<void> {
    try {
      await this.producer_.connect();
      await this.consumer_.connect();
      this.isConnected_ = true;
      console.log('✅ Successfully connected to Kafka');
    } catch (error) {
      console.error(
        `❌ Failed to connect to Kafka (attempt ${attempt}/${this.maxRetries_}):`,
        error.message,
      );

      if (attempt < this.maxRetries_) {
        console.log(`⏳ Retrying in ${this.retryDelay_ / 1000} seconds...`);
        await new Promise((resolve) => setTimeout(resolve, this.retryDelay_));
        return this.retryConnect_(attempt + 1);
      } else {
        console.error(
          '❌ Max retry attempts reached. Failed to connect to Kafka.',
        );
        throw error;
      }
    }
  }

  async connect() {
    if (this.isConnected_) return;

    await this.retryConnect_();

    // 외부 Kafka 이벤트 구독 설정
    if (this.isConnected_) {
      await this.setupExternalSubscriptions();
    }
  }

  async publishEvent(eventName: string, data: any): Promise<void> {
    try {
      if (!this.isConnected_) {
        await this.connect();
      }

      await this.producer_.send({
        topic: eventName,
        messages: [
          {
            value: JSON.stringify({
              eventName,
              data,
              timestamp: new Date().toISOString(),
            }),
          },
        ],
      });
      console.log(`✅ Successfully published event: ${eventName}`);
    } catch (error) {
      console.error(`❌ Failed to publish event ${eventName}:`, error);
      throw error;
    }
  }

  async subscribe(
    topics: string[],
    handler: (payload: EachMessagePayload) => Promise<void>,
  ) {
    try {
      if (!this.isConnected_) {
        await this.connect();
      }

      // kafkajs는 run 호출 후에는 subscribe를 추가로 수행할 수 없음
      // 여러 토픽을 구독하려면 run 이전에 각 토픽별로 subscribe를 호출해야 함
      for (const topic of topics) {
        await this.consumer_.subscribe({ topic, fromBeginning: false });
      }

      await this.consumer_.run({ eachMessage: handler });
      console.log(`✅ Successfully subscribed to topics:`, topics);
    } catch (error) {
      console.error(`❌ Failed to subscribe to topics ${topics}:`, error);
      throw error;
    }
  }

  async disconnect() {
    try {
      await this.producer_.disconnect();
      await this.consumer_.disconnect();
      this.isConnected_ = false;
      console.log('✅ Successfully disconnected from Kafka');
    } catch (error) {
      console.error('❌ Failed to disconnect from Kafka:', error);
      throw error;
    }
  }

  /**
   * 외부 Kafka 발행 이벤트를 구독하고,
   * Medusa 내부 이벤트 버스로 변환하여 전달합니다.
   *
   * 이 메서드는 다른 서비스(user-service 등)에서 발행하는 Kafka 이벤트를
   * Medusa 내부 이벤트 시스템으로 브릿지하는 역할을 합니다.
   */
  private async setupExternalSubscriptions() {
    console.log('🔌 Setting up external Kafka subscriptions...');

    // 구독할 외부 Kafka 토픽 목록
    // - PAYMENT_EVENTS.REFUND_COMPLETED: 결제 환불 완료 이벤트
    // - USER_EVENTS.USER_PERMANENT_DELETED: 유저 영구 삭제 이벤트
    // - 'USER_PERMANENT_DELETED': 레거시 호환성을 위한 추가 토픽
    // - INVENTORY_STREAM: WMS 재고 변동 이벤트
    const inventoryTopic = INVENTORY_STREAM.topic.topic; // 'inventory.events.v1'
    const topics = [
      PAYMENT_EVENTS.REFUND_COMPLETED.topic,
      USER_EVENTS.USER_PERMANENT_DELETED.topic,
      'USER_PERMANENT_DELETED',
      inventoryTopic,
    ];

    // 모든 토픽을 단일 핸들러로 구독
    // 각 메시지는 topic 필드로 구분하여 처리
    await this.subscribe(topics, async (payload) => {
      try {
        if (!payload.message?.value) {
          console.warn('Received empty message');
          return;
        }

        const topic = payload.topic;
        const message = JSON.parse(payload.message.value.toString());

        // ==========================================
        // 결제 환불 완료 이벤트 처리
        // ==========================================
        // user-service나 payment-service에서 환불이 완료되었을 때 발행되는 이벤트
        // Medusa 내부에서 'payment.refunded' 이벤트로 변환되어 전파됨
        if (topic === PAYMENT_EVENTS.REFUND_COMPLETED.topic) {
          console.log('💰 Received payment.refunded:', message);
          const { refundId, data, completedAt } = message;

          try {
            const { Modules } = await import('@medusajs/framework/utils');
            const eventBus = this.container_?.resolve(Modules.EVENT_BUS);
            if (eventBus) {
              await eventBus.emit({
                name: 'payment.refunded',
                data: {
                  refundId, // 환불 ID
                  refundedAt: completedAt, // 환불 완료 시각
                  rawData: data, // 원본 데이터 (추가 정보 포함)
                },
              });
              console.log('✅ Refund event forwarded to internal event bus');
            }
          } catch (err) {
            console.log('EventBus not available yet, processing directly');
          }
          return;
        }

        // ==========================================
        // 유저 영구 삭제 이벤트 처리
        // ==========================================
        // user-service에서 휴면 계정이 영구 삭제될 때 발행되는 이벤트
        // Medusa의 customer 모듈에서 해당 유저와 연결된 customer 데이터를 정리하기 위해 사용
        // metadata.almond_user_id로 매핑된 customer를 찾아 삭제 처리
        if (
          topic === USER_EVENTS.USER_PERMANENT_DELETED.topic ||
          topic === 'USER_PERMANENT_DELETED' // 레거시 호환성
        ) {
          console.log('🧹 Received user.permanent.deleted:', message);
          const { userId, deletedAt } = message;

          try {
            const { Modules } = await import('@medusajs/framework/utils');
            const eventBus = this.container_?.resolve(Modules.EVENT_BUS);
            if (eventBus) {
              // 'user.deleted' 이벤트로 변환하여 내부 전파
              // subscribers/user.deleted.ts에서 이 이벤트를 수신하여 처리
              await eventBus.emit({
                name: 'user.deleted',
                data: {
                  userId, // user-service의 유저 ID
                  deletedAt, // 삭제 시각
                  rawData: message, // 원본 메시지 (디버깅용)
                },
              });
              console.log(
                '✅ User deleted event forwarded to internal event bus',
              );
            }
          } catch (err) {
            console.log('EventBus not available yet, processing directly');
          }
          return;
        }

        // ==========================================
        // WMS 재고 변동 이벤트 처리
        // ==========================================
        // WMS에서 재고 입고/출고/조정 이벤트가 발생->Medusa의 Inventory Module을 통해 재고 업데이트
        if (topic === inventoryTopic) {
          const { eventType, data } = message;
          console.log(`📦 Received inventory event: ${eventType}`, data);

          try {
            await this.handleInventoryEvent(eventType, data);
          } catch (err) {
            console.error('Failed to handle inventory event:', err);
          }
          return;
        }

        // 처리되지 않은 토픽이 들어온 경우 경고 로그
        // 새로운 이벤트 타입 추가 시 이곳에서 확인 가능
        console.warn(`Unhandled topic received: ${topic}`);
      } catch (error) {
        console.error('Error processing incoming Kafka message:', error);
      }
    });

    console.log('✅ External Kafka subscriptions ready');
  }

  /**
   * WMS 재고 이벤트 처리
   *
   * StockReceived (입고), StockShipped (출고), StockAdjusted (조정) 이벤트를
   * Medusa Inventory Module로 반영합니다.
   */
  private async handleInventoryEvent(eventType: string, data: any): Promise<void> {
    const { skuCode, quantity, deltaQuantity, afterQuantity, warehouseId } = data;

    if (!skuCode) {
      console.warn('Inventory event missing skuCode:', data);
      return;
    }

    try {
      const { Modules } = await import('@medusajs/framework/utils');
      const inventoryService = this.container_?.resolve(Modules.INVENTORY);
      const productService = this.container_?.resolve(Modules.PRODUCT);

      if (!inventoryService || !productService) {
        console.warn('Inventory or Product service not available');
        return;
      }

      // 1. SKU로 variant 조회
      const [variant] = await productService.listProductVariants({
        sku: skuCode,
      });

      if (!variant) {
        console.warn(`Variant not found for SKU: ${skuCode}`);
        return;
      }

      // 2. Variant의 Inventory Item 조회
      const inventoryItems = await inventoryService.listInventoryItems({
        sku: skuCode,
      });

      if (!inventoryItems || inventoryItems.length === 0) {
        console.warn(`No inventory item for SKU: ${skuCode}`);
        return;
      }

      const inventoryItem = inventoryItems[0];

      // 3. Stock Location 조회 (기본 위치 사용)
      const stockLocations = await inventoryService.listStockLocations({});
      const location = stockLocations?.[0];

      if (!location) {
        console.warn('No stock location found');
        return;
      }

      // 4. 이벤트 타입에 따라 재고 업데이트
      let newQuantity: number;

      switch (eventType) {
        case 'StockReceived':
          // 입고: 현재 재고 + 입고량
          newQuantity = await this.getCurrentStockAndAdd(
            inventoryService,
            inventoryItem.id,
            location.id,
            quantity,
          );
          break;

        case 'StockShipped':
          // 출고: 현재 재고 - 출고량
          newQuantity = await this.getCurrentStockAndSubtract(
            inventoryService,
            inventoryItem.id,
            location.id,
            quantity,
          );
          break;

        case 'StockAdjusted':
          // 조정: 조정 후 수량으로 직접 설정
          newQuantity = afterQuantity ?? 0;
          break;

        default:
          console.log(`Unhandled inventory event type: ${eventType}`);
          return;
      }

      // 5. Inventory Level 업데이트
      await inventoryService.updateInventoryLevels([
        {
          inventory_item_id: inventoryItem.id,
          location_id: location.id,
          stocked_quantity: Math.max(0, newQuantity),
        },
      ]);

      console.log(`Inventory updated: SKU=${skuCode}, qty=${newQuantity}`);
    } catch (error) {
      console.error(`Failed to update inventory for ${skuCode}:`, error);
      throw error;
    }
  }

  private async getCurrentStockAndAdd(
    inventoryService: any,
    inventoryItemId: string,
    locationId: string,
    addQuantity: number,
  ): Promise<number> {
    const levels = await inventoryService.listInventoryLevels({
      inventory_item_id: inventoryItemId,
      location_id: locationId,
    });
    const currentQty = levels?.[0]?.stocked_quantity ?? 0;
    return currentQty + addQuantity;
  }

  private async getCurrentStockAndSubtract(
    inventoryService: any,
    inventoryItemId: string,
    locationId: string,
    subtractQuantity: number,
  ): Promise<number> {
    const levels = await inventoryService.listInventoryLevels({
      inventory_item_id: inventoryItemId,
      location_id: locationId,
    });
    const currentQty = levels?.[0]?.stocked_quantity ?? 0;
    return Math.max(0, currentQty - subtractQuantity);
  }
}
