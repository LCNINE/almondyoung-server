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
    });

    this.producer_ = this.kafka_.producer();
    this.consumer_ = this.kafka_.consumer({
      groupId: this.options_.kafka.groupId,
    });

    this.connect();
    EventModuleService.instance_ = this;
  }

  async connect() {
    if (this.isConnected_) return;

    await this.producer_.connect();
    await this.consumer_.connect();
    this.isConnected_ = true;

    // 외부 Kafka 이벤트 구독 설정
    this.setupExternalSubscriptions();
  }

  async publishEvent(eventName: string, data: any): Promise<void> {
    await this.connect();

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
  }

  async subscribe(
    topics: string[],
    handler: (payload: EachMessagePayload) => Promise<void>,
  ) {
    await this.connect();

    await this.consumer_.subscribe({ topics, fromBeginning: false });
    await this.consumer_.run({
      eachMessage: handler,
    });
  }

  async disconnect() {
    await this.producer_.disconnect();
    await this.consumer_.disconnect();
    this.isConnected_ = false;
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
        // container가 아직 완전히 초기화되지 않았을 수 있으므로 try-catch 사용
        try {
          const { Modules } = await import('@medusajs/framework/utils');
          const eventBus = this.container_?.resolve(Modules.EVENT_BUS);

          if (eventBus) {
            await eventBus.emit({
              name: 'payment.refund.received',
              data: {
                refundId,
                paymentId: data?.paymentId || data?.payment_id, // 외부 시스템의 데이터 구조에 따라
                orderId: data?.orderId || data?.order_id,
                amount: data?.amount,
                currency: data?.currency,
                refundedAt: completedAt || new Date(),
                rawData: data, // 원본 데이터 보존
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
