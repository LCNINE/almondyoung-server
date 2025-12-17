# File Service - Deployment Guide

## Prerequisites

- Node.js 18+
- PostgreSQL database
- AWS S3 bucket (for production) or local storage (for development)

---

## Database Migration

### Generate Migration

From the project root:

```bash
cd apps/file-service
npx drizzle-kit generate:pg --config=./src/database/drizzle/drizzle.config.ts
```

This will create a migration file in `src/database/drizzle/migrations/`

### Apply Migration

```bash
npx drizzle-kit push:pg --config=./src/database/drizzle/drizzle.config.ts
```

Or run migrations programmatically in your application startup.

---

## Environment Configuration

### Development (.env.development)

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/almondyoung_dev
PORT=3005

# Storage - Local
STORAGE_PROVIDER=LOCAL

# Optional: S3 (for testing S3 in dev)
# AWS_REGION=ap-northeast-2
# AWS_ACCESS_KEY_ID=your_dev_key
# AWS_SECRET_ACCESS_KEY=your_dev_secret
# AWS_S3_BUCKET=almondyoung-dev-files
```

### Production (.env.production)

```bash
# Database
DATABASE_URL=postgresql://user:password@prod-host:5432/almondyoung_prod
PORT=3005

# Storage - S3
STORAGE_PROVIDER=S3
AWS_REGION=ap-northeast-2
AWS_ACCESS_KEY_ID=${AWS_KEY_FROM_SECRETS}
AWS_SECRET_ACCESS_KEY=${AWS_SECRET_FROM_SECRETS}
AWS_S3_BUCKET=almondyoung-prod-files

# Optional: CloudWatch, etc.
```

---

## Running the Service

### Development

```bash
# From project root
npm run start:dev file-service
```

The service will start on `http://localhost:3005` (or the configured PORT)

### Production

```bash
# Build
npm run build file-service

# Run
npm run start:prod file-service
```

---

## API Documentation

Once the service is running, access Swagger documentation at:

```
http://localhost:3005/api
```

---

## Health Check

Basic health check endpoint:

```bash
curl http://localhost:3005/health
```

---

## Storage Setup

### Local Storage (Development)

Files will be stored in: `apps/file-service/uploads/`

This directory is created automatically on first upload.

### S3 Storage (Production)

#### Create S3 Bucket

```bash
aws s3 mb s3://almondyoung-prod-files --region ap-northeast-2
```

#### Configure Bucket Policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "FileServiceAccess",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::ACCOUNT_ID:user/file-service"
      },
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::almondyoung-prod-files/*"
    }
  ]
}
```

#### Enable CORS (if needed for direct browser uploads)

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
    "AllowedOrigins": ["https://your-frontend-domain.com"],
    "ExposeHeaders": []
  }
]
```

---

## Monitoring

### Logs

Monitor logs for:

- `[UploadService]` - Upload operations
- `[LifecycleService]` - File deletion

### Metrics to Track

1. **Upload Metrics**
   - Total uploads per day
   - Upload failures
   - Average upload time
   - Upload size distribution

2. **Storage Metrics**
   - Total storage used
   - Storage growth rate
   - Files by status (active/deleted)

---

## Troubleshooting

### Issue: Files not uploading

1. Check storage provider configuration
2. Verify AWS credentials (if using S3)
3. Check file size limits
4. Review error logs

### Issue: S3 permissions error

1. Verify IAM user has correct permissions
2. Check bucket policy
3. Verify region configuration

---

## Database Maintenance

### Check File Status Distribution

```sql
SELECT status, COUNT(*) 
FROM uploads 
GROUP BY status;
```

### Storage Usage by Context

```sql
SELECT context, COUNT(*) as file_count, SUM(size) as total_bytes
FROM uploads
WHERE status = 'active'
GROUP BY context
ORDER BY total_bytes DESC;
```

---

## Security Checklist

- [ ] JWT authentication implemented
- [ ] File type validation enabled
- [ ] File size limits configured
- [ ] S3 bucket is private (not public)
- [ ] Signed URLs have expiration
- [ ] Environment variables are secure
- [ ] Database credentials are encrypted
- [ ] CORS configured for trusted domains only

---

## Performance Optimization

### Database Indexes

All necessary indexes are included in the schema:
- `idx_uploads_status`
- `idx_uploads_context`
- `idx_uploads_related`
- `idx_uploads_uploaded_by`
- `idx_uploads_created_at`

### S3 Optimization

- Files are organized by date and context for efficient partitioning
- Use CloudFront CDN for frequently accessed files (future enhancement)

---

## Backup Strategy

### Database Backups

Regular backups of `uploads` and `file_references` tables:

```bash
pg_dump -t uploads -t file_references dbname > file_service_backup.sql
```

### S3 Backups

Enable S3 versioning:

```bash
aws s3api put-bucket-versioning \
  --bucket almondyoung-prod-files \
  --versioning-configuration Status=Enabled
```

Consider S3 lifecycle policies for cost optimization:
- Move old files to Glacier after 90 days
- Delete old versions after 365 days

---

## Scaling Considerations

### Horizontal Scaling

- Multiple instances can run concurrently

### Database Scaling

- Read replicas for metadata queries
- Connection pooling configured in DbModule

### Storage Scaling

- S3 scales automatically
- Consider multi-region replication for global access

---

## Support

For issues or questions, refer to:
- [Architecture Documentation](./architecture.md)
- [Storage Provider Pattern](./storage-provider-pattern.md)

