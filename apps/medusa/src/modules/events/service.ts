import { AbstractEventBusModuleService } from "@medusajs/framework/utils"
import { EventBusTypes, InternalModuleDeclaration } from "@medusajs/types"
import { Kafka, Producer, Consumer, SASLOptions, logLevel, LogEntry } from "kafkajs"

// 무시할 메시지 패턴
const IGNORED_MESSAGES = [
  "This server does not host this topic-partition",
  "The group is rebalancing",
]

const customLogger = () => {
  return ({ level, log }: LogEntry) => {
    const { message } = log
    // 무시할 메시지는 출력하지 않음
    if (IGNORED_MESSAGES.some((ignored) => message?.includes(ignored))) {
      return
    }
    // 나머지는 정상 출력
    if (level === logLevel.ERROR) {
      console.error("[Kafka]", message)
    } else if (level === logLevel.WARN) {
      console.warn("[Kafka]", message)
    }
  }
}

type KafkaEventOptions = {
  brokers: string[]
  clientId: string
  groupId?: string
  topics?: string[]
  sasl?: {
    mechanism: "plain"
    username: string
    password: string
  }
  ssl?: boolean
}

class MyKafkaEventService extends AbstractEventBusModuleService {
  protected producer_: Producer
  protected consumer_: Consumer
  protected options_: KafkaEventOptions
  protected kafka_: Kafka

  constructor(
    cradle: Record<string, unknown>,
    moduleOptions: KafkaEventOptions,
    moduleDeclaration: InternalModuleDeclaration
  ) {
    super(cradle, moduleOptions, moduleDeclaration)
    this.options_ = moduleOptions

    this.kafka_ = new Kafka({
      clientId: moduleOptions.clientId,
      brokers: moduleOptions.brokers,
      ssl: moduleOptions.ssl,
      sasl: moduleOptions.sasl as SASLOptions,
      logLevel: logLevel.ERROR,
      logCreator: customLogger,
    })

    this.producer_ = this.kafka_.producer()
    this.consumer_ = this.kafka_.consumer({
      groupId: moduleOptions.groupId || "medusa-consumer-group",
    })

    this.initializeKafka()
  }

  private async initializeKafka(): Promise<void> {
    try {
      await this.producer_.connect()
      console.log("Kafka producer connected")

      await this.consumer_.connect()
      console.log("Kafka consumer connected")

      const topics = this.options_.topics || ["user.updated"]
      await this.consumer_.subscribe({
        topics,
        fromBeginning: false,
      })

      await this.consumer_.run({
        eachMessage: async ({ topic, message }) => {
          if (!message.value) return

          try {
            const data = JSON.parse(message.value.toString())
            console.log(`Received Kafka message from topic: ${topic}`, data)

            // 내부 subscriber들에게 이벤트 전달
            const subscribers = this.eventToSubscribersMap.get(topic) || []
            for (const { subscriber } of subscribers) {
              await subscriber({ name: topic, data })
            }
          } catch (err) {
            console.error(`Failed to process Kafka message from ${topic}:`, err)
          }
        },
      })

      console.log(`Kafka consumer subscribed to topics: ${topics.join(", ")}`)
    } catch (err) {
      console.error("Kafka initialization failed:", err)
    }
  }

  async emit<T>(
    data: EventBusTypes.Message<T> | EventBusTypes.Message<T>[],
    _options?: Record<string, unknown>
  ): Promise<void> {
    const events = Array.isArray(data) ? data : [data]

    // Medusa 내부 이벤트는 Kafka로 발행하지 않음 (구독 중인 외부 토픽만 발행)
    const externalTopics = this.options_.topics || []
    const externalEvents = events.filter((e) => externalTopics.includes(e.name))

    if (externalEvents.length === 0) {
      return
    }

    try {
      await this.producer_.connect()
    } catch (connectErr) {
      console.warn(
        "[KafkaEventService] Producer connect failed; events will not be published:",
        connectErr instanceof Error ? connectErr.message : connectErr
      )
      return
    }

    for (const event of externalEvents) {
      try {
        await this.producer_.send({
          topic: event.name,
          messages: [{ value: JSON.stringify(event.data) }],
        })
      } catch (sendErr) {
        console.warn(
          `[KafkaEventService] emit failed for topic "${event.name}":`,
          sendErr instanceof Error ? sendErr.message : sendErr
        )
      }
    }
  }

  async releaseGroupedEvents(_eventGroupId: string): Promise<void> {
    // grouped events 지원 시 구현
  }

  async clearGroupedEvents(_eventGroupId: string): Promise<void> {
    // grouped events 지원 시 구현
  }
}

export default MyKafkaEventService
