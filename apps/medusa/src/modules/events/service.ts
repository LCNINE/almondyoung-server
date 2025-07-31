import { Kafka, Producer, Consumer, EachMessagePayload } from 'kafkajs';
import { MedusaService } from '@medusajs/framework/utils';

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

      await this.consumer_.subscribe({ topics, fromBeginning: false });
      await this.consumer_.run({
        eachMessage: handler,
      });
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
   * 외부 시스템의 Kafka 이벤트 구독 설정
   */
  private async setupExternalSubscriptions() {
    console.log('🔌 Setting up external Kafka subscriptions...');

    // payment.refunded 이벤트 구독
    await this.subscribe(['payment.refunded'], async (payload) => {
      try {
        if (!payload.message?.value) {
          console.warn('Received empty payment.refunded message');
          return;
        }

        const message = JSON.parse(payload.message.value.toString());
        console.log('💰 Received payment.refunded:', message);

        // 외부에서 받은 데이터 구조: { refundId, data, completedAt }
        const { refundId, data, completedAt } = message;

        // Medusa 내부 이벤트 버스로 변환
        try {
          const { Modules } = await import('@medusajs/framework/utils');
          const eventBus = this.container_?.resolve(Modules.EVENT_BUS);

          if (eventBus) {
            await eventBus.emit({
              name: 'payment.refund.received',
              data: {
                refundId,
                paymentId: data?.paymentId || data?.payment_id,
                orderId: data?.orderId || data?.order_id,
                amount: data?.amount,
                currency: data?.currency,
                refundedAt: completedAt || new Date(),
                rawData: data,
              },
            });
            console.log('✅ Refund event forwarded to internal event bus');
          }
        } catch (err) {
          console.log('EventBus not available yet, processing directly');
          // EventBus를 사용할 수 없으면 직접 처리
        }
      } catch (error) {
        console.error('Error processing payment.refunded:', error);
      }
    });

    console.log('✅ External Kafka subscriptions ready');
  }
}
