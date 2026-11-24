# Google Cloud Platform (GCP) Deployment Guide

This guide walks you through deploying the **PugArch Connect Portal** (Next.js Frontend + Express TypeScript Backend) to **Google Cloud Run**.

---

## 🏗️ Architecture Overview

The single repository contains both the frontend and backend. The primary **[Dockerfile](file:///c:/Pugarch/sahaj/connect.pugarch/Dockerfile)** packages both services into a unified, production-ready container:

```
                          Internet / Users / Meta WhatsApp Webhooks
                                            │
                                            ▼
                           GCP Cloud Run Ingress ($PORT, default 8080)
                                            │
                                            ▼
                                  ┌──────────────────┐
                                  │   Nginx Proxy    │
                                  └─────────┬────────┘
                                            │
                    ┌───────────────────────┴───────────────────────┐
                    │                                               │
                    ▼ (/ , /_next/*)                                ▼ (/api/*, /webhook/*, /health)
       ┌────────────────────────┐                      ┌────────────────────────┐
       │   Next.js (Port 3000)  │                      │   Express (Port 5001)  │
       │   Frontend & SSR       │                      │   REST API & Webhooks  │
       └────────────────────────┘                      └────────────────────────┘
```

### Key Advantages:
1. **Single Cloud Run Service**: Zero need to manage multiple services or duplicate billing.
2. **Zero CORS Issues**: Browser makes requests to `/api/...` on the exact same origin.
3. **WhatsApp Webhooks**: Meta Graph callbacks (`/webhook`, `/api/webhook`) are forwarded directly to Express without payload distortion.
4. **Cloud Run Dynamic Port**: Nginx listens on `$PORT` injected dynamically by Google Cloud Run.
5. **Supervisor Process Manager**: Automatically starts, monitors, and forwards `SIGTERM` signals for graceful shutdown of both services.

---

## 🚀 Quick Deployment to GCP Cloud Run (Step-by-Step)

### Prerequisites:
1. Install the [Google Cloud SDK (`gcloud`)](https://cloud.google.com/sdk/docs/install).
2. Authenticate:
   ```bash
   gcloud auth login
   gcloud auth application-default login
   ```
3. Set your GCP project:
   ```bash
   gcloud config set project YOUR_GCP_PROJECT_ID
   ```
4. Enable required GCP services:
   ```bash
   gcloud services enable run.googleapis.com \
       artifactregistry.googleapis.com \
       cloudbuild.googleapis.com \
       secretmanager.googleapis.com
   ```

---

### Step 1: Create an Artifact Registry Repository (One-time)

```bash
gcloud artifacts repositories create pugarch-repo \
    --repository-format=docker \
    --location=asia-southeast1 \
    --description="Docker repository for PugArch Connect"
```
*(Using `asia-southeast1` Singapore or `asia-south1` Mumbai based on your project region).*

---

### Step 2: Grant Cloud Build Permissions (One-time)

Cloud Build needs permission to deploy to Cloud Run and push to Artifact Registry:

```bash
# Get your project number
PROJECT_NUMBER=$(gcloud projects describe whatsapp-chatbot-490106 --format='value(projectNumber)')

# Grant Cloud Run Admin
gcloud projects add-iam-policy-binding whatsapp-chatbot-490106 \
    --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
    --role="roles/run.admin"

# Grant Service Account User (to act as the runtime service account)
gcloud projects add-iam-policy-binding whatsapp-chatbot-490106 \
    --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
    --role="roles/iam.serviceAccountUser"

# Grant Artifact Registry Writer
gcloud projects add-iam-policy-binding whatsapp-chatbot-490106 \
    --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
    --role="roles/artifactregistry.writer"
```

---

### Step 3: Automated Build & Deploy via `cloudbuild.yaml` (Recommended)

Run the entire pipeline with a single command! It builds Next.js standalone and Express, pushes immutable SHA tags, and deploys to Cloud Run:

```bash
gcloud builds submit --config=cloudbuild.yaml .
```

To override any substitution variables (e.g. region, service name, min-instances):
```bash
gcloud builds submit --config=cloudbuild.yaml \
    --substitutions=_REGION="asia-southeast1",_SERVICE_NAME="connect-pugarch",_MIN_INSTANCES="1" .
```

---

### Step 4: Configure Continuous Deployment (GitHub Trigger)

To trigger builds and deployments automatically every time you push to the `main` branch:

```bash
gcloud builds triggers create github \
    --name="deploy-connect-pugarch-main" \
    --repo-owner="pugarchdev" \
    --repo-name="connect.pugarch" \
    --branch-pattern="^main$" \
    --build-config="cloudbuild.yaml"
```

---

### Step 5: Manual Deployment (Alternative via gcloud CLI)

```bash
gcloud run deploy connect-pugarch \
    --image asia-southeast1-docker.pkg.dev/whatsapp-chatbot-490106/pugarch-repo/connect-pugarch:latest \
    --platform managed \
    --region asia-southeast1 \
    --allow-unauthenticated \
    --port 8080 \
    --memory 2Gi \
    --cpu 2 \
    --min-instances 1 \
    --max-instances 10 \
    --timeout 300s \
    --service-account="whatsappchatbotserviceadmin@whatsapp-chatbot-490106.iam.gserviceaccount.com" \
    --set-env-vars NODE_ENV=production,FRONTEND_URL=https://connect.pugarch.in \
    --set-env-vars MONGODB_URI="your_mongodb_connection_string" \
    --set-env-vars JWT_SECRET="your_jwt_secret_min_32_chars" \
    --set-env-vars JWT_EXPIRES_IN="7d",JWT_REFRESH_SECRET="your_refresh_secret" \
    --set-env-vars GCS_BUCKET_NAME="chatbot-media-storage-490106",GCP_PROJECT_ID="whatsapp-chatbot-490106"
```

> 💡 **Service Account & ADC (Recommended)**:
> By attaching `--service-account="whatsappchatbotserviceadmin@whatsapp-chatbot-490106.iam.gserviceaccount.com"`, Cloud Run automatically authenticates to Google Cloud Storage using **Application Default Credentials (ADC)** without needing any service account JSON string or secret!
>
> 💡 **Best Practice for Secrets**: Use [GCP Secret Manager](https://cloud.google.com/secret-manager) instead of plain environment variables for `MONGODB_URI` and `JWT_SECRET`:
> ```bash
> --set-secrets="MONGODB_URI=mongodb-uri:latest,JWT_SECRET=jwt-secret:latest"
> ```

---

## ⚙️ Environment Variables Reference

| Variable | Description | Example / Default | Required? |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | Application environment | `production` | Yes |
| `PORT` | Container ingress port | `8080` (automatically set by Cloud Run) | Cloud Run sets this |
| `MONGODB_URI` | MongoDB Atlas / Cloud connection URI | `mongodb+srv://user:pass@cluster.mongodb.net/dbname` | **Yes** |
| `JWT_SECRET` | Secret key for JWT signing | `min_32_character_random_secret` | **Yes** |
| `ALLOW_EMPTY_USERS_ON_STARTUP` | Allow empty DB on initial deploy | `true` (fresh DB) or omit | Only on fresh DB |
| `REDIS_HOST` | Redis instance host (optional, has fallback) | `10.x.x.x` or Upstash Redis URL | Optional |
| `REDIS_PORT` | Redis instance port | `6379` | Optional |
| `REDIS_PASSWORD` | Redis auth password | `password` | Optional |
| `GCP_PROJECT_ID` | GCP Project ID for GCS Media Storage | `whatsapp-chatbot-490106` | Yes (for media) |
| `GCS_BUCKET_NAME` | GCS Bucket for media files | `chatbot-media-storage-490106` | Yes (for media) |
| `GCP_SERVICE_ACCOUNT_JSON` | Service account JSON string (optional, can be raw JSON or Base64) | `{"type":"service_account",...}` or base64 string | Optional (ADC is automatic on GCP) |

---

## 🛠️ GCP Troubleshooting & Resolved Issues

### 1. 502 Bad Gateway / Connection Refused on `127.0.0.1:3000`
- **Cause**: Next.js was previously invoked with `node_modules/.bin/next start`, which failed inside Supervisord, or Nginx started before Next.js and Express had finished binding ports.
- **Resolution**:
  1. Next.js is now compiled with `output: 'standalone'` and starts via pure Node: `node server.js` on `0.0.0.0:3000`.
  2. Nginx start is synchronized via `wait-and-start-nginx.sh`, which verifies both Express (`5001/health`) and Next.js (`3000`) before opening port `8080`.
  3. Express binds port `5001` immediately upon boot while asynchronous database and GCS initializations proceed in the background.

### 2. `❌ Failed to parse GCP_SERVICE_ACCOUNT_JSON`
- **Cause**: Passing JSON in CLI flags or environment variables often breaks due to comma-delimited argument parsers, unescaped `\n` in private keys, or surrounding quotes.
- **Resolution**:
  1. `parseServiceAccountJson` automatically handles raw JSON, single/double quotes, unescaped newlines, and base64-encoded strings (`Buffer.from(raw, 'base64')`).
  2. If the JSON string is omitted or invalid, it gracefully falls back to **GCP Application Default Credentials (ADC)** or local key file without crashing.
  3. On Google Cloud Run, simply assign the IAM service account to the service (`--service-account`), and credentials will be resolved automatically.

### 3. GCS Bucket Metadata Update Conflict (`code 9: The metadata was edited during the operation`)
- **Cause**: Multiple Cloud Run instances or concurrent requests ran `bucket.setCorsConfiguration()` and `bucket.makePublic()` concurrently during startup.
- **Resolution**:
  1. Bucket CORS and public access operations are wrapped in isolated non-fatal handlers that catch code 9 metadata conflicts.
  2. In `uploadBufferToGCS`, uploads automatically fall back gracefully if Uniform Bucket-Level Access (UBLA) is active instead of object-level ACLs.

---

## 🧪 Local Testing with Docker

If you have Docker installed and wish to test the unified container locally:

```bash
# 1. Build the image
docker build -t connect-portal:latest .

# 2. Run container
docker run -p 8080:8080 \
  -e MONGODB_URI="your_mongodb_uri" \
  -e JWT_SECRET="test_secret_1234567890_1234567890" \
  -e ALLOW_EMPTY_USERS_ON_STARTUP="true" \
  connect-portal:latest
```

Then visit:
- **Frontend Portal**: `http://localhost:8080`
- **Backend Health Check**: `http://localhost:8080/health`
- **Backend API**: `http://localhost:8080/api/health`

Alternatively, use `docker compose up` to spin up the portal together with MongoDB and Redis.

---

## 🌐 Custom Domain & WhatsApp Meta Webhook Setup

1. **Map Custom Domain in Cloud Run**:
   - Go to Google Cloud Console > Cloud Run > Manage Custom Domains.
   - Map `connect.pugarch.in` (or your chosen domain) to the Cloud Run service.

2. **Configure WhatsApp Callback in Meta Developer Portal**:
   - Webhook URL: `https://your-domain.com/webhook` (or `https://your-domain.com/api/webhook`)
   - Verify Token: Matches your Meta App verify token.
