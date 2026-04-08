import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import type { Query } from "@medusajs/framework"
import { updateCustomersWorkflow } from "@medusajs/medusa/core-flows"

type UserUpdatedEvent = {
  messageType: string
  messageKind: string
  source: {
    service: string
    aggregateType: string
    aggregateId: string
  }
  payload: {
    userId: string
    username?: string
    nickname?: string
    phoneNumber?: string
    birthDate?: string
    profileImageUrl?: string
  }
}

export default async function userUpdatedHandler({
  event: { data },
  container,
}: SubscriberArgs<UserUpdatedEvent>) {
  console.log("[user.updated] Event received:", JSON.stringify(data, null, 2))

  // UserUpdated 이벤트만 처리
  if (data.messageType !== "UserUpdated") {
    return
  }

  const query = container.resolve<Query>("query")

  const { data: customers } = await query.graph({
    entity: "customer",
    fields: ["id"],
    filters: {
      metadata: { almond_user_id: data.payload.userId },
    },
    pagination: { take: 1 },
  })

  const customer = customers[0]

  if (!customer) {
    console.log(`Customer not found for almond_user_id: ${data.payload.userId}`)
    return
  }

  // username이 있으면 first_name 업데이트
  if (data.payload.username) {
    await updateCustomersWorkflow(container).run({
      input: {
        selector: { id: [customer.id] },
        update: { first_name: data.payload.username },
      },
    })
  }
}

export const config: SubscriberConfig = {
  event: "users.events.v1",
}
