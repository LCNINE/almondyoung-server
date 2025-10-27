# WMS Purchase Order Audit Workflow - Testing Guide

**Date:** 2025-10-27
**Version:** 1.0
**Implementation:** Week 8 - Purchase Order Audit Workflow

---

## Overview

This guide provides comprehensive testing procedures for the newly implemented Purchase Order Audit Workflow feature.

### State Machine

```
draft ──[submit]──> pending_audit ──[approve]──> approved
                           │
                           └──[reject]──> draft (can revise)
```

---

## Pre-Testing Checklist

Before running tests, ensure:

- [ ] Database migrations applied (`npm run db:push.wms`)
- [ ] WMS application is running
- [ ] You have a valid purchase order ID for testing
- [ ] API testing tool ready (curl, Postman, or similar)

---

## Test Suite

### Test 1: Submit PO for Audit (Happy Path)

**Scenario:** Submit a draft PO for audit approval

**Prerequisites:**
- A purchase order in 'draft' status

**Request:**
```bash
curl -X PUT http://localhost:3000/wms/purchase-orders/{PO_ID}/submit-for-audit \
  -H "Content-Type: application/json" \
  -d '{
    "notes": "Please review this purchase order for approval"
  }'
```

**Expected Response:**
```json
{
  "id": "uuid",
  "auditStatus": "pending_audit",
  "submittedAt": "2025-10-27T10:00:00.000Z",
  "message": "검토 요청이 제출되었습니다. (Submitted for audit)"
}
```

**Validation:**
- [ ] Status code: 200
- [ ] `auditStatus` changed to `pending_audit`
- [ ] `submittedAt` timestamp present
- [ ] Database: `submitted_for_audit_at`, `audit_notes` updated

---

### Test 2: Approve PO (Happy Path)

**Scenario:** Approve a pending_audit PO

**Prerequisites:**
- A purchase order in 'pending_audit' status

**Request:**
```bash
curl -X PUT http://localhost:3000/wms/purchase-orders/{PO_ID}/approve \
  -H "Content-Type: application/json" \
  -d '{
    "approvalNotes": "Approved - all items verified"
  }'
```

**Expected Response:**
```json
{
  "id": "uuid",
  "auditStatus": "approved",
  "approvedAt": "2025-10-27T10:05:00.000Z",
  "message": "발주가 승인되었습니다. (Purchase order approved)"
}
```

**Validation:**
- [ ] Status code: 200
- [ ] `auditStatus` changed to `approved`
- [ ] `approvedAt` timestamp present
- [ ] Database: `audited_at`, `audited_by`, `audit_notes` updated

---

### Test 3: Reject PO (Returns to Draft)

**Scenario:** Reject a pending_audit PO, returning it to draft

**Prerequisites:**
- A purchase order in 'pending_audit' status

**Request:**
```bash
curl -X PUT http://localhost:3000/wms/purchase-orders/{PO_ID}/reject \
  -H "Content-Type: application/json" \
  -d '{
    "rejectionReason": "SKU quantities exceed budget limits"
  }'
```

**Expected Response:**
```json
{
  "id": "uuid",
  "auditStatus": "draft",
  "rejectedAt": "2025-10-27T10:10:00.000Z",
  "reason": "SKU quantities exceed budget limits",
  "message": "발주가 거부되었습니다. 수정 후 재제출하세요. (Purchase order rejected, please revise and resubmit)"
}
```

**Validation:**
- [ ] Status code: 200
- [ ] `auditStatus` reset to `draft`
- [ ] `rejectedAt` timestamp present
- [ ] Database: `audit_notes` contains "REJECTED: {reason}"
- [ ] PO can now be edited and resubmitted

---

### Test 4: Error - Submit Non-Draft PO

**Scenario:** Attempt to submit a PO that is not in draft status

**Prerequisites:**
- A purchase order in 'pending_audit' or 'approved' status

**Request:**
```bash
curl -X PUT http://localhost:3000/wms/purchase-orders/{PO_ID}/submit-for-audit \
  -H "Content-Type: application/json" \
  -d '{
    "notes": "Trying to submit again"
  }'
```

**Expected Response:**
```json
{
  "statusCode": 400,
  "message": "Cannot submit: current audit status is pending_audit, expected 'draft'",
  "error": "Bad Request"
}
```

**Validation:**
- [ ] Status code: 400
- [ ] Error message indicates invalid state transition
- [ ] Database: No changes to PO

---

### Test 5: Error - Approve Non-Pending PO

**Scenario:** Attempt to approve a PO that is not pending_audit

**Prerequisites:**
- A purchase order in 'draft' or 'approved' status

**Request:**
```bash
curl -X PUT http://localhost:3000/wms/purchase-orders/{PO_ID}/approve \
  -H "Content-Type: application/json" \
  -d '{
    "approvalNotes": "Approving"
  }'
```

**Expected Response:**
```json
{
  "statusCode": 400,
  "message": "Cannot approve: current audit status is draft, expected 'pending_audit'",
  "error": "Bad Request"
}
```

**Validation:**
- [ ] Status code: 400
- [ ] Error message indicates invalid state transition
- [ ] Database: No changes to PO

---

### Test 6: Error - Reject Non-Pending PO

**Scenario:** Attempt to reject a PO that is not pending_audit

**Prerequisites:**
- A purchase order in 'draft' or 'approved' status

**Request:**
```bash
curl -X PUT http://localhost:3000/wms/purchase-orders/{PO_ID}/reject \
  -H "Content-Type: application/json" \
  -d '{
    "rejectionReason": "Some reason"
  }'
```

**Expected Response:**
```json
{
  "statusCode": 400,
  "message": "Cannot reject: current audit status is draft, expected 'pending_audit'",
  "error": "Bad Request"
}
```

**Validation:**
- [ ] Status code: 400
- [ ] Error message indicates invalid state transition
- [ ] Database: No changes to PO

---

### Test 7: Error - PO Not Found

**Scenario:** Attempt audit action on non-existent PO

**Prerequisites:**
- A non-existent PO ID (e.g., all zeros)

**Request:**
```bash
curl -X PUT http://localhost:3000/wms/purchase-orders/00000000-0000-0000-0000-000000000000/submit-for-audit \
  -H "Content-Type: application/json" \
  -d '{
    "notes": "Test"
  }'
```

**Expected Response:**
```json
{
  "statusCode": 404,
  "message": "Purchase order 00000000-0000-0000-0000-000000000000 not found",
  "error": "Not Found"
}
```

**Validation:**
- [ ] Status code: 404
- [ ] Error message indicates PO not found

---

### Test 8: Error - Missing Required Field (Reject)

**Scenario:** Attempt to reject without providing rejectionReason

**Prerequisites:**
- A purchase order in 'pending_audit' status

**Request:**
```bash
curl -X PUT http://localhost:3000/wms/purchase-orders/{PO_ID}/reject \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected Response:**
```json
{
  "statusCode": 400,
  "message": ["rejectionReason should not be empty", "rejectionReason must be a string"],
  "error": "Bad Request"
}
```

**Validation:**
- [ ] Status code: 400
- [ ] Validation error for missing required field
- [ ] Database: No changes to PO

---

### Test 9: Complete Workflow (Draft → Pending → Approved)

**Scenario:** Test complete happy path workflow

**Steps:**

1. **Create PO** (will be in 'draft' status by default)
2. **Submit for audit** → `pending_audit`
3. **Approve PO** → `approved`

**Validation:**
- [ ] Each step succeeds
- [ ] Status progresses correctly
- [ ] All timestamps recorded
- [ ] Audit trail complete

---

### Test 10: Revision Workflow (Draft → Pending → Rejected → Draft → Pending → Approved)

**Scenario:** Test rejection and resubmission flow

**Steps:**

1. **Create PO** → `draft`
2. **Submit for audit** → `pending_audit`
3. **Reject PO** → `draft` (with rejection reason)
4. **(Optional) Edit PO** - Make corrections
5. **Resubmit for audit** → `pending_audit`
6. **Approve PO** → `approved`

**Validation:**
- [ ] Rejection resets to draft
- [ ] Can resubmit after rejection
- [ ] Audit notes track rejection reason
- [ ] Final approval succeeds

---

## Database Verification

After each test, verify the database state:

```sql
-- Check audit fields
SELECT 
    id,
    audit_status,
    submitted_for_audit_at,
    submitted_for_audit_by,
    audited_at,
    audited_by,
    audit_notes,
    created_at,
    updated_at
FROM purchase_orders
WHERE id = '{PO_ID}';
```

### Expected Field Values by Status

| Status | `audit_status` | `submitted_for_audit_at` | `audited_at` | `audit_notes` |
|--------|---------------|-------------------------|--------------|---------------|
| draft (new) | draft | NULL | NULL | NULL |
| pending_audit | pending_audit | timestamp | NULL | submission notes |
| approved | approved | timestamp | timestamp | approval notes |
| draft (rejected) | draft | timestamp | timestamp | "REJECTED: {reason}" |

---

## Integration Testing Notes

### User Context

In production, the `userId` parameter should be passed from the authentication context:

```typescript
// Example controller modification for auth
async submitForAudit(
    @Param('id') id: string,
    @Body() dto: SubmitForAuditDto,
    @CurrentUser() user: User  // From auth decorator
): Promise<any> {
    return this.purchaseOrderService.submitForAudit(id, dto, user.id);
}
```

Currently, the `userId` parameter is optional and defaults to `null`.

### Transaction Safety

All audit methods use the `inTx` helper for transaction safety:
- Database changes are atomic
- Failures rollback automatically
- Multiple operations are consistent

---

## Performance Testing

### Response Time Targets

- Submit/Approve/Reject: < 100ms
- Database queries: < 50ms
- Transaction overhead: < 20ms

### Load Testing Scenarios

1. **Concurrent submissions**: 10 users submitting different POs simultaneously
2. **Concurrent approvals**: 5 approvers processing different POs
3. **Mixed operations**: Random mix of submit/approve/reject on different POs

---

## Swagger/OpenAPI Testing

1. Navigate to: `http://localhost:3000/api` (or your Swagger endpoint)
2. Find **Purchase Orders** section
3. Locate the three new endpoints:
   - `PUT /:id/submit-for-audit`
   - `PUT /:id/approve`
   - `PUT /:id/reject`
4. Test using Swagger UI's "Try it out" feature

**Validation:**
- [ ] All endpoints appear in Swagger
- [ ] Request/response schemas correct
- [ ] Descriptions clear (bilingual Korean/English)
- [ ] Example values helpful

---

## Known Limitations & Future Enhancements

### Current Implementation
- No email notifications on status changes
- No approval delegation/routing
- Single-level approval (no multi-stage)
- No audit log history view

### Planned Enhancements (Future Phases)
- Multi-level approval workflow
- Email notifications
- Audit trail dashboard
- Approval rules based on PO amount
- Bulk approval operations

---

## Troubleshooting

### Issue: "Cannot submit" error on fresh PO

**Cause:** PO was not created with default `auditStatus: 'draft'`

**Solution:** Verify schema default value is set:
```typescript
auditStatus: poAuditStatusEnum('audit_status').default('draft')
```

### Issue: Audit fields are NULL after migration

**Cause:** Migration may not have applied defaults to existing rows

**Solution:** Run update to set existing POs to 'draft':
```sql
UPDATE purchase_orders 
SET audit_status = 'draft' 
WHERE audit_status IS NULL;
```

### Issue: State transition validation failing

**Cause:** Enum values may be case-sensitive

**Solution:** Ensure exact enum match:
- `'draft'` ✅
- `'Draft'` ❌
- `'DRAFT'` ❌

---

## Test Results Log Template

```
Date: _____________
Tester: _____________
Environment: _____________

| Test # | Test Name | Status | Notes |
|--------|-----------|--------|-------|
| 1 | Submit Draft PO | ✅ / ❌ | |
| 2 | Approve Pending PO | ✅ / ❌ | |
| 3 | Reject Pending PO | ✅ / ❌ | |
| 4 | Submit Non-Draft Error | ✅ / ❌ | |
| 5 | Approve Non-Pending Error | ✅ / ❌ | |
| 6 | Reject Non-Pending Error | ✅ / ❌ | |
| 7 | PO Not Found Error | ✅ / ❌ | |
| 8 | Missing Field Error | ✅ / ❌ | |
| 9 | Complete Workflow | ✅ / ❌ | |
| 10 | Revision Workflow | ✅ / ❌ | |

Overall Result: ✅ PASS / ❌ FAIL
```

---

## Next Steps After Testing

Once all tests pass:

1. ✅ Mark step-8-test as complete
2. ✅ Document any issues found
3. ✅ Update API documentation
4. ✅ Notify frontend team of new endpoints
5. ✅ Schedule user acceptance testing (UAT)
6. 🚀 Deploy to staging environment

---

## Contact & Support

For questions or issues with the audit workflow:
- Review implementation: `apps/wms/src/inbound/services/purchase-order.service.ts`
- Check schema: `apps/wms/database/schemas/wms-schema.ts`
- Refer to guide: `docs/figma-comparison/IMPLEMENTATION_GUIDE_PHASES_2-4_DETAILED.md`

**Good luck with testing! 🎯**

