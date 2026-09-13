"""Find the S3 bucket and region behind the CDN prefix. Reads creds from server/.env.

Run from server/:  .venv\Scripts\python tools\discover_bucket.py
Prints the bucket name and region to put back into .env (S3_BUCKET, AWS_REGION).
"""
from __future__ import annotations

import os
from pathlib import Path

import boto3
import botocore
from botocore.config import Config

env = Path(__file__).resolve().parent.parent / ".env"
for line in env.read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())

probe_key = f"{os.environ.get('S3_PREFIX', 'shubhkamna2026')}/news-new.jpeg"
s3 = boto3.client(
    "s3",
    region_name=os.environ.get("AWS_REGION") or "ap-south-1",
    config=Config(connect_timeout=8, read_timeout=15, retries={"max_attempts": 2}),
)

named = os.environ.get("S3_BUCKET")
candidates = [named] if named else []
if not candidates:
    try:
        candidates = [b["Name"] for b in s3.list_buckets().get("Buckets", [])]
        print("buckets visible to this key:", candidates)
    except Exception as exc:  # noqa: BLE001
        print("could not list buckets:", type(exc).__name__, str(exc)[:150])
        print("Set S3_BUCKET in .env to the bucket name and re-run.")
        raise SystemExit(1)

for bucket in candidates:
    try:
        s3.head_object(Bucket=bucket, Key=probe_key)
        region = s3.get_bucket_location(Bucket=bucket).get("LocationConstraint") or "us-east-1"
        print(f"\nMATCH -> put these in server/.env:\n  S3_BUCKET={bucket}\n  AWS_REGION={region}")
        break
    except botocore.exceptions.ClientError as exc:
        code = exc.response["Error"]["Code"]
        if code not in ("404", "NoSuchKey", "NotFound"):
            print(f"  {bucket}: {code}")
else:
    print(f"\nNo bucket contained {probe_key!r}. Confirm the prefix, or set S3_BUCKET manually.")
