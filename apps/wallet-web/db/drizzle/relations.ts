import { relations } from "drizzle-orm/relations";

import {
  manualCancelQueueItems,
  paymentAttempts,
  paymentIntentItemDiscounts,
  paymentIntentItems,
  paymentIntentOrderDiscounts,
  paymentIntents,
  paymentLegs,
  refundAllocations,
  refundRequests,
} from "./schema";

export const paymentIntentsRelations = relations(paymentIntents, ({ many }) => ({
  paymentIntentItems: many(paymentIntentItems),
  paymentIntentItemDiscounts: many(paymentIntentItemDiscounts),
  paymentIntentOrderDiscounts: many(paymentIntentOrderDiscounts),
  paymentLegs: many(paymentLegs),
  paymentAttempts: many(paymentAttempts),
  manualCancelQueueItems: many(manualCancelQueueItems),
  refundRequests: many(refundRequests),
  refundAllocations: many(refundAllocations),
}));

export const paymentIntentItemsRelations = relations(
  paymentIntentItems,
  ({ one, many }) => ({
    paymentIntent: one(paymentIntents, {
      fields: [paymentIntentItems.intentId],
      references: [paymentIntents.id],
    }),
    paymentIntentItemDiscounts: many(paymentIntentItemDiscounts),
  })
);

export const paymentIntentItemDiscountsRelations = relations(
  paymentIntentItemDiscounts,
  ({ one }) => ({
    paymentIntent: one(paymentIntents, {
      fields: [paymentIntentItemDiscounts.intentId],
      references: [paymentIntents.id],
    }),
    paymentIntentItem: one(paymentIntentItems, {
      fields: [paymentIntentItemDiscounts.itemId],
      references: [paymentIntentItems.id],
    }),
  })
);

export const paymentIntentOrderDiscountsRelations = relations(
  paymentIntentOrderDiscounts,
  ({ one }) => ({
    paymentIntent: one(paymentIntents, {
      fields: [paymentIntentOrderDiscounts.intentId],
      references: [paymentIntents.id],
    }),
  })
);

export const paymentLegsRelations = relations(paymentLegs, ({ one, many }) => ({
  paymentIntent: one(paymentIntents, {
    fields: [paymentLegs.intentId],
    references: [paymentIntents.id],
  }),
  paymentAttempts: many(paymentAttempts),
  manualCancelQueueItems: many(manualCancelQueueItems),
  refundAllocations: many(refundAllocations),
}));

export const paymentAttemptsRelations = relations(paymentAttempts, ({ one }) => ({
  paymentIntent: one(paymentIntents, {
    fields: [paymentAttempts.intentId],
    references: [paymentIntents.id],
  }),
  paymentLeg: one(paymentLegs, {
    fields: [paymentAttempts.legId],
    references: [paymentLegs.id],
  }),
}));

export const manualCancelQueueItemsRelations = relations(
  manualCancelQueueItems,
  ({ one }) => ({
    paymentIntent: one(paymentIntents, {
      fields: [manualCancelQueueItems.intentId],
      references: [paymentIntents.id],
    }),
    paymentLeg: one(paymentLegs, {
      fields: [manualCancelQueueItems.legId],
      references: [paymentLegs.id],
    }),
  })
);

export const refundRequestsRelations = relations(refundRequests, ({ one, many }) => ({
  paymentIntent: one(paymentIntents, {
    fields: [refundRequests.intentId],
    references: [paymentIntents.id],
  }),
  refundAllocations: many(refundAllocations),
}));

export const refundAllocationsRelations = relations(refundAllocations, ({ one }) => ({
  refundRequest: one(refundRequests, {
    fields: [refundAllocations.refundRequestId],
    references: [refundRequests.id],
  }),
  paymentIntent: one(paymentIntents, {
    fields: [refundAllocations.intentId],
    references: [paymentIntents.id],
  }),
  paymentLeg: one(paymentLegs, {
    fields: [refundAllocations.legId],
    references: [paymentLegs.id],
  }),
}));
