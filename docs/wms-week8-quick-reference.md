# Week 8: Purchase Order Audit Workflow - Quick Reference

## 🚀 Quick Start

### Database Migration
```bash
npm run db:generate.wms
npm run db:push.wms
```

### Update Existing POs (if any)
```sql
UPDATE purchase_orders SET audit_status = 'draft' WHERE audit_status IS NULL;
```

---

## 📊 State Machine

```
draft ──[submit]──> pending_audit ──[approve]──> approved
                           │
                           └──[reject]──> draft
```

---

## 🔌 API Endpoints

### 1. Submit for Audit
```bash
PUT /wms/purchase-orders/:id/submit-for-audit
Content-Type: application/json

{
  "notes": "Please review this PO" // optional
}
```

### 2. Approve PO
```bash
PUT /wms/purchase-orders/:id/approve
Content-Type: application/json

{
  "approvalNotes": "Approved" // optional
}
```

### 3. Reject PO
```bash
PUT /wms/purchase-orders/:id/reject
Content-Type: application/json

{
  "rejectionReason": "Budget exceeded" // REQUIRED
}
```

---

## ✅ Quick Test

```bash
# Get a PO ID
PO_ID="your-po-id-here"

# 1. Submit
curl -X PUT http://localhost:3000/wms/purchase-orders/$PO_ID/submit-for-audit \
  -H "Content-Type: application/json" \
  -d '{"notes":"Test submission"}'

# 2. Approve
curl -X PUT http://localhost:3000/wms/purchase-orders/$PO_ID/approve \
  -H "Content-Type: application/json" \
  -d '{"approvalNotes":"Test approval"}'
```

---

## 🗄️ Database Fields

| Field | Type | Description |
|-------|------|-------------|
| `audit_status` | enum | 'draft', 'pending_audit', 'approved', 'rejected' |
| `submitted_for_audit_at` | timestamp | When submitted |
| `submitted_for_audit_by` | uuid | Who submitted |
| `audited_at` | timestamp | When approved/rejected |
| `audited_by` | uuid | Who approved/rejected |
| `audit_notes` | text | Notes/reason |

---

## ⚠️ Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| "Cannot submit: expected 'draft'" | PO not in draft | Only draft POs can be submitted |
| "Cannot approve: expected 'pending_audit'" | PO not pending | Only pending POs can be approved |
| "rejectionReason should not be empty" | Missing field | Rejection reason is required |
| "Purchase order not found" | Invalid ID | Check PO ID exists |

---

## 📚 Documentation

- **Full Implementation:** `docs/wms-week8-implementation-summary.md`
- **Testing Guide:** `docs/wms-audit-workflow-testing-guide.md`
- **Source Guide:** `docs/figma-comparison/IMPLEMENTATION_GUIDE_PHASES_2-4_DETAILED.md`

---

## 🎯 Files Modified

### Created:
- `apps/wms/src/inbound/dto/purchase-order/audit-po.dto.ts`

### Modified:
- `apps/wms/database/schemas/wms-schema.ts`
- `apps/wms/src/inbound/services/purchase-order.service.ts`
- `apps/wms/src/inbound/controllers/purchase-order.controller.ts`

---

## 📋 Pre-Production Checklist

- [ ] Run database migrations
- [ ] Test all endpoints
- [ ] Verify Swagger documentation
- [ ] Update existing POs to draft status
- [ ] Notify frontend team
- [ ] Run integration tests
- [ ] Deploy to staging

---

**Status:** ✅ COMPLETE - Ready for testing!

