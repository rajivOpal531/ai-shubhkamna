# AI Shubhkamna — Deployment Guide (for the AWS deployer)

This app has **two parts**. S3 hosts only the first one.

| Part | What it is | Where it runs |
|---|---|---|
| **Frontend** | A static Vite/React build (HTML/JS/CSS) | **S3 + CloudFront** |
| **Backend** | A Python FastAPI service that removes photo backgrounds (rembg), composites the card, and decrypts the user profile | **A container host — AWS App Runner or ECS Fargate. NOT S3.** S3 cannot run it. |

The backend needs ~2 GB RAM (it loads an ML model) and must be served over **HTTPS**, because the frontend page is HTTPS and a browser will refuse to call an HTTP backend.

---

## Current setup: EC2 + Caddy behind CloudFront

This is what runs `shubhkamnauat.narendramodi.in` today. The App Runner / S3 sections further down
are the original plan, kept for reference.

```
Browser ──HTTPS──► CloudFront (+ WAF) ──HTTP :80──► EC2: Caddy ─┬─ /composite /cutout /profile /health ─► api container (:8000)
                                                               └─ everything else ─► dist/ (frontend build)
```

- **One EC2 host** (`ap-south-1`) runs `deploy/docker-compose.yml`: `api`, built from `server/`, and
  `caddy`, which serves `dist/` and proxies the API routes using `deploy/caddy/Caddyfile`.
- **CloudFront** has a single origin, the EC2 public DNS name (HTTP only, port 80). The default
  behavior allows all methods, uses **CachingDisabled**, and an origin request policy with all viewer
  headers plus the **`CloudFront-Viewer-Address`** header (Caddy forwards it so per-IP rate limiting
  sees the real user).
- **WAF** (CloudFront core protections): in `AWSManagedRulesCommonRuleSet`, rule
  **`SizeRestrictions_BODY` is overridden to Count**. Otherwise every photo upload over 8 KB is
  blocked with a CloudFront 403.
- **Security group**: port 80 only from the managed prefix list
  `com.amazonaws.global.cloudfront.origin-facing`; port 22 only from the admin IP. No 443.

### One-time host setup

Needs only Docker with the compose plugin; the frontend is built inside `node:20-alpine`.

```bash
git clone https://github.com/rajivOpal531/ai-shubhkamna ~/ai-shubhkamna
cd ~/ai-shubhkamna/deploy
cp ../server/.env.example api.env && chmod 600 api.env   # fill in the secrets (see server/README.md)
echo "SERVER_NAME=mumbai" > .env                          # optional: sent back as the X-Served-By header
./deploy.sh all
```

`api.env` and `.env` are gitignored; never commit them.

### Deploying a change

```bash
~/ai-shubhkamna/deploy/deploy.sh ui    # frontend only (src/, public/, index.html)
~/ai-shubhkamna/deploy/deploy.sh api   # backend only (server/)
~/ai-shubhkamna/deploy/deploy.sh       # both
```

The script pulls `master`, builds what changed, reloads Caddy without downtime, and replaces the API
with `deploy/rollout-api.sh`:

1. A new `api` container starts next to the running one (`docker compose --scale api=2`).
2. If its image and config are identical to the running one, it is removed at once (nothing to do).
3. Otherwise the script waits for its `/health` (loading the model takes about a minute), then stops
   the old container, which gets 30 s to finish in-flight requests.

Caddy resolves every `api` container and retries a refused connection on another one, so requests
keep working throughout: no 502s while the model loads. If the new container crashes or never gets
healthy, it is removed and the old one keeps serving (the script exits non-zero). With less than
2.5 GB of free RAM it falls back to an in-place restart, which does cause about a minute of errors.

### Adding a backend route

Add the path to the `@api path` line in `deploy/caddy/Caddyfile` in the same change. A route missing
from that line never reaches the API: Caddy answers it with the frontend (`index.html`, or a 405 for
POST).

---

## Recommended architecture (simplest, no CORS)

One CloudFront distribution on the site domain (`shubhkamnauat.narendramodi.in`) with **two origins**:

- **Default (`/*`)** → the **S3 bucket** holding the frontend build.
- **`/composite` and `/profile`** → the **backend** (App Runner URL, or an ALB in front of Fargate).

Because the app and the API then share one origin, there is no CORS to configure and one certificate covers everything. The frontend is already built to call `/composite` and `/profile` as relative paths for exactly this setup.

```
                    shubhkamnauat.narendramodi.in
                              │
                        ┌── CloudFront ──┐
              default /*│                │ /composite, /profile
                        ▼                ▼
                   S3 (frontend)    App Runner / Fargate (backend container)
```

---

## 1. Backend (container)

The backend lives in `server/`. It builds from `server/Dockerfile`.

### Build and push the image to ECR
```bash
cd server
aws ecr create-repository --repository-name ai-shubhkamna-api   # once
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REGION=ap-south-1
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ACCOUNT.dkr.ecr.$REGION.amazonaws.com
docker build -t ai-shubhkamna-api .
docker tag ai-shubhkamna-api:latest $ACCOUNT.dkr.ecr.$REGION.amazonaws.com/ai-shubhkamna-api:latest
docker push $ACCOUNT.dkr.ecr.$REGION.amazonaws.com/ai-shubhkamna-api:latest
```

### Run it (App Runner — simplest)
Create an App Runner service from that ECR image. Settings:
- **Port:** 8000 (the container reads `$PORT`; App Runner sets it).
- **Memory:** 2 GB, **CPU:** 1 vCPU (the ML model needs the memory).
- **Health check path:** `/health`.
- **Environment variables** (see the table below).

App Runner gives you an HTTPS URL like `https://xxxx.ap-south-1.awsapprunner.com`. That URL is the CloudFront origin for `/composite` and `/profile`.

(ECS Fargate works too: same image, a 2 GB task, behind an ALB with an ACM certificate. More setup, cheaper at steady load.)

### Backend environment variables

| Variable | Required | Value |
|---|---|---|
| `RESPONSE_MODE` | yes | `image` (returns the card as a file; no S3 needed for storage) |
| `ALLOWED_ORIGINS` | yes | `https://shubhkamnauat.narendramodi.in` (the site origin) |
| `USER_JWT_TOKEN_SECRET_KEY` | yes | **secret — get from the project owner** (JWT signing secret) |
| `PROFILE_DECRYPT_KEY` | yes | **secret — get from the project owner** |
| `PROFILE_DECRYPT_IV` | yes | **secret — get from the project owner** |
| `RATE_LIMIT_PER_MINUTE` | no | `10` (per user token) |
| `RATE_LIMIT_PER_IP_PER_MINUTE` | no | `30` (per source IP) |

The three secret values are **not in this repo** and must be provided separately by the project owner. They enable the name/constituency/state prefill and must never be committed or exposed to the browser. Everything else in `server/README.md` documents the service in detail.

**No AWS keys or S3 config are needed for the backend** — `RESPONSE_MODE=image` means the finished card is posted to the NaMo Media Wall as a file, not stored in S3.

---

## 2. Frontend (static → S3)

```bash
# from the repo root
cp .env.production.example .env.production      # edit if the backend is NOT same-origin
npm ci
npm run build                                    # outputs dist/
aws s3 sync dist/ s3://<your-frontend-bucket>/ --delete
# then invalidate CloudFront so the new build is served:
aws cloudfront create-invalidation --distribution-id <ID> --paths "/*"
```

`.env.production` (copied from `.env.production.example`) holds only public config, no secrets. With the recommended single-CloudFront setup, leave `VITE_COMPOSITE_URL=/composite` and `VITE_PROFILE_URL=/profile` as-is.

---

## 3. CloudFront

- **Origin 1:** the S3 bucket (use an Origin Access Control so the bucket isn't public).
- **Origin 2:** the backend (App Runner URL or ALB).
- **Default behavior** → Origin 1 (S3). Enable SPA fallback: a 403/404 response returns `/index.html` with 200.
- **Behavior `/composite`** → Origin 2. **Allowed methods:** GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE. **Cache policy:** CachingDisabled. **Origin request policy:** forward all headers (incl. `Authorization`) and the body.
- **Behavior `/profile`** → same as `/composite`.
- **Alternate domain name:** `shubhkamnauat.narendramodi.in`, with an ACM certificate (in `us-east-1` for CloudFront) and a DNS record pointing the domain at the distribution.

Origin response timeout: 30–60s is plenty (a card takes ~2s).

---

## 4. Verify after deploy

1. `curl https://shubhkamnauat.narendramodi.in/health` (via the backend behavior, or hit the App Runner URL directly) → `{"status":"ok","model_loaded":true,...}`.
2. Open `https://shubhkamnauat.narendramodi.in/?jwt=<a real token>` on a phone or browser. The name field should prefill; upload a portrait; the card should composite and preview; Post should land it on the Media Wall.

---

## What the deployer needs from the project owner

1. **The three backend secrets** (`USER_JWT_TOKEN_SECRET_KEY`, `PROFILE_DECRYPT_KEY`, `PROFILE_DECRYPT_IV`) — share out of band, never in email/repo if avoidable.
2. **The S3 bucket name / CloudFront distribution** to use (or permission to create them).
3. **The production NaMo URLs** (home, media wall, create-post) once configured — until then the UAT URLs in `.env.production.example` work.
