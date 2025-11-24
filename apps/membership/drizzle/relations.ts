import { relations } from "drizzle-orm/relations";
import { subscriptionEntitlement, pauseEvents, tiers, eventBatches, subscriptionPolicies, subscriptionContracts, membershipDunningQueue, pauseEventDetails, billingEvents, plan, subscriptionContractEvents } from "./schema";

export const pauseEventsRelations = relations(pauseEvents, ({one, many}) => ({
	subscriptionEntitlement: one(subscriptionEntitlement, {
		fields: [pauseEvents.entitlementId],
		references: [subscriptionEntitlement.id]
	}),
	pauseEvent: one(pauseEvents, {
		fields: [pauseEvents.previousEventId],
		references: [pauseEvents.id],
		relationName: "pauseEvents_previousEventId_pauseEvents_id"
	}),
	pauseEvents: many(pauseEvents, {
		relationName: "pauseEvents_previousEventId_pauseEvents_id"
	}),
	pauseEventDetails: many(pauseEventDetails),
}));

export const subscriptionEntitlementRelations = relations(subscriptionEntitlement, ({one, many}) => ({
	pauseEvents: many(pauseEvents),
	tier: one(tiers, {
		fields: [subscriptionEntitlement.tierId],
		references: [tiers.id]
	}),
	eventBatch_sourceBatchId: one(eventBatches, {
		fields: [subscriptionEntitlement.sourceBatchId],
		references: [eventBatches.id],
		relationName: "subscriptionEntitlement_sourceBatchId_eventBatches_id"
	}),
	eventBatch_closedBatchId: one(eventBatches, {
		fields: [subscriptionEntitlement.closedBatchId],
		references: [eventBatches.id],
		relationName: "subscriptionEntitlement_closedBatchId_eventBatches_id"
	}),
	pauseEventDetails: many(pauseEventDetails),
}));

export const tiersRelations = relations(tiers, ({many}) => ({
	subscriptionEntitlements: many(subscriptionEntitlement),
	subscriptionPolicies: many(subscriptionPolicies),
	plans: many(plan),
}));

export const eventBatchesRelations = relations(eventBatches, ({many}) => ({
	subscriptionEntitlements_sourceBatchId: many(subscriptionEntitlement, {
		relationName: "subscriptionEntitlement_sourceBatchId_eventBatches_id"
	}),
	subscriptionEntitlements_closedBatchId: many(subscriptionEntitlement, {
		relationName: "subscriptionEntitlement_closedBatchId_eventBatches_id"
	}),
	subscriptionContractEvents: many(subscriptionContractEvents),
}));

export const subscriptionPoliciesRelations = relations(subscriptionPolicies, ({one}) => ({
	tier: one(tiers, {
		fields: [subscriptionPolicies.tierId],
		references: [tiers.id]
	}),
}));

export const membershipDunningQueueRelations = relations(membershipDunningQueue, ({one}) => ({
	subscriptionContract: one(subscriptionContracts, {
		fields: [membershipDunningQueue.contractId],
		references: [subscriptionContracts.id]
	}),
}));

export const subscriptionContractsRelations = relations(subscriptionContracts, ({one, many}) => ({
	membershipDunningQueues: many(membershipDunningQueue),
	billingEvents: many(billingEvents),
	plan: one(plan, {
		fields: [subscriptionContracts.planId],
		references: [plan.id]
	}),
	subscriptionContractEvents: many(subscriptionContractEvents),
}));

export const pauseEventDetailsRelations = relations(pauseEventDetails, ({one, many}) => ({
	pauseEvent: one(pauseEvents, {
		fields: [pauseEventDetails.pauseEventId],
		references: [pauseEvents.id]
	}),
	subscriptionEntitlement: one(subscriptionEntitlement, {
		fields: [pauseEventDetails.entitlementId],
		references: [subscriptionEntitlement.id]
	}),
	pauseEventDetail: one(pauseEventDetails, {
		fields: [pauseEventDetails.originalDetailId],
		references: [pauseEventDetails.id],
		relationName: "pauseEventDetails_originalDetailId_pauseEventDetails_id"
	}),
	pauseEventDetails: many(pauseEventDetails, {
		relationName: "pauseEventDetails_originalDetailId_pauseEventDetails_id"
	}),
}));

export const billingEventsRelations = relations(billingEvents, ({one}) => ({
	subscriptionContract: one(subscriptionContracts, {
		fields: [billingEvents.contractId],
		references: [subscriptionContracts.id]
	}),
}));

export const planRelations = relations(plan, ({one, many}) => ({
	tier: one(tiers, {
		fields: [plan.tierId],
		references: [tiers.id]
	}),
	subscriptionContracts: many(subscriptionContracts),
}));

export const subscriptionContractEventsRelations = relations(subscriptionContractEvents, ({one}) => ({
	eventBatch: one(eventBatches, {
		fields: [subscriptionContractEvents.batchId],
		references: [eventBatches.id]
	}),
	subscriptionContract: one(subscriptionContracts, {
		fields: [subscriptionContractEvents.contractId],
		references: [subscriptionContracts.id]
	}),
}));