import { Kafka, Producer, Consumer, EachMessagePayload } from 'kafkajs';

type ModuleOptions = {
  kafka: {
    clientId: string;
    brokers: string[];
    groupId: string;
  };
};

export default class EventModuleService {
  private static instance_: EventModuleService;
  private kafka_: Kafka;
  private producer_: Producer;
  private consumer_: Consumer;
  private isConnected_: boolean = false;
  private options_: ModuleOptions;

  constructor({}, options: ModuleOptions) {
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
}
