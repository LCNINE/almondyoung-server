# Policy Rule Types Documentation

This document describes all available policy rule types in the membership subscription system.

## Pause-Related Policies

### MAX_PAUSES_PER_YEAR
- **Description**: Maximum number of subscription pauses allowed per calendar year
- **Rule Value**: `{ limit: number }`
- **Example**: `{ limit: 2 }`

### MIN_PAUSE_DURATION_DAYS
- **Description**: Minimum duration for a subscription pause
- **Rule Value**: `{ minDays: number }`
- **Example**: `{ minDays: 7 }`

### MAX_PAUSE_DURATION_DAYS
- **Description**: Maximum duration for a subscription pause
- **Rule Value**: `{ maxDays: number }`
- **Example**: `{ maxDays: 90 }`

### PAUSE_COOLDOWN_DAYS
- **Description**: Minimum days between consecutive pause requests
- **Rule Value**: `{ cooldownDays: number }`
- **Example**: `{ cooldownDays: 30 }`

### PAUSE_BLACKOUT_PERIODS
- **Description**: Date ranges when pauses are not allowed
- **Rule Value**: `{ blackoutPeriods: Array<{ start: string, end: string }> }`
- **Example**: `{ blackoutPeriods: [{ start: "2024-12-01", end: "2024-12-31" }] }`

## Plan Change Policies

### PLAN_CHANGE_COOLDOWN_DAYS
- **Description**: Minimum days between plan changes
- **Rule Value**: `{ cooldownDays: number }`
- **Example**: `{ cooldownDays: 30 }`

### ALLOWED_PLAN_CHANGES
- **Description**: Defines which plan transitions are allowed
- **Rule Value**: `{ allowedChanges: Array<{ from: string, to: string[] }> }`
- **Example**: `{ allowedChanges: [{ from: "BASIC", to: ["PREMIUM", "PRO"] }] }`

### DOWNGRADE_RESTRICTIONS
- **Description**: Rules for plan downgrades
- **Rule Value**: `{ restrictions: object }`
- **Example**: `{ restrictions: { requiresConfirmation: true, gracePeriodDays: 7 } }`

### UPGRADE_BENEFITS
- **Description**: Special benefits for plan upgrades
- **Rule Value**: `{ benefits: object }`
- **Example**: `{ benefits: { immediateAccess: true, prorationCredit: true } }`

## Tier-Specific Policies

### TIER_SPECIFIC_LIMITS
- **Description**: Limits that apply to specific subscription tiers
- **Rule Value**: `{ limits: object }`
- **Example**: `{ limits: { maxUsers: 10, storageGB: 100 } }`

### VIP_USER_BENEFITS
- **Description**: Special benefits for VIP tier users
- **Rule Value**: `{ benefits: object }`
- **Example**: `{ benefits: { prioritySupport: true, unlimitedPauses: true } }`

### NEW_USER_GRACE_PERIOD
- **Description**: Grace period policies for new users
- **Rule Value**: `{ gracePeriodDays: number, benefits: object }`
- **Example**: `{ gracePeriodDays: 30, benefits: { freeTrialExtension: true } }`

## Promotional Policies

### PROMOTIONAL_PERIODS
- **Description**: Special rules during promotional periods
- **Rule Value**: `{ periods: Array<{ start: string, end: string, rules: object }> }`
- **Example**: `{ periods: [{ start: "2024-11-01", end: "2024-11-30", rules: { discountPercent: 50 } }] }`

### SEASONAL_RESTRICTIONS
- **Description**: Seasonal limitations on certain actions
- **Rule Value**: `{ restrictions: object }`
- **Example**: `{ restrictions: { holidayPauseLimit: 1 } }`

### SPECIAL_EVENT_RULES
- **Description**: Rules that apply during special events
- **Rule Value**: `{ eventRules: object }`
- **Example**: `{ eventRules: { bonusCredits: 100, extendedTrial: true } }`

## Implementation Status

- ✅ **Implemented**: MAX_PAUSES_PER_YEAR, MIN_PAUSE_DURATION_DAYS
- 🚧 **Pending**: All other policy types require implementation in business logic
- 📝 **Testing**: New policy types need comprehensive test coverage

## Usage Examples

```typescript
// Creating a new policy
const policy = await policyService.createPolicy({
  ruleType: 'MAX_PAUSE_DURATION_DAYS',
  ruleValue: { maxDays: 60 },
  tierId: 'premium-tier-id'
});

// Validating against a policy
const validation = await policyEngine.validateRequest({
  userId: 'user-123',
  action: 'PAUSE_SUBSCRIPTION',
  context: { requestedDays: 45 }
});
```