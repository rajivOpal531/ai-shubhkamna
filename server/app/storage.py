"""Where finished cards go. S3 in production, memory in tests."""
from __future__ import annotations

import re
import uuid
from typing import Any, Protocol

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

S3_CONFIG = Config(
    connect_timeout=5,
    read_timeout=30,  # max body is 10 MB; 30 s is generous
    retries={"max_attempts": 3, "mode": "standard"},
)
PREFIX_PATTERN = re.compile(r"[A-Za-z0-9._\-/]*")
BUCKET_PATTERN = re.compile(r"[a-z0-9][a-z0-9\-]{1,61}[a-z0-9]")


class UploadError(RuntimeError):
    """The object store rejected the upload."""


class Uploader(Protocol):
    def upload_jpeg(self, data: bytes) -> str:  # returns a public URL
        ...


class S3ClientLike(Protocol):
    def put_object(self, **kwargs: Any) -> Any: ...


class S3Uploader:
    """Uploads JPEGs to S3 and returns a virtual-hosted-style public URL.

    The bucket must live in `region`: cross-region PUTs may be redirected or rejected by
    S3; either way the virtual-hosted URL returned here would be wrong.
    """

    def __init__(
        self,
        bucket: str,
        region: str,
        prefix: str = "ai-shubh",
        public_read_acl: bool = False,
        client: S3ClientLike | None = None,
    ) -> None:
        if not bucket:
            raise ValueError("S3_BUCKET is not set")
        if not BUCKET_PATTERN.fullmatch(bucket):
            raise ValueError(
                "S3_BUCKET must be a DNS-compatible bucket name (lowercase letters, digits, hyphens)"
            )
        if not region:
            raise ValueError("AWS_REGION is not set")
        if not PREFIX_PATTERN.fullmatch(prefix):
            raise ValueError("S3_PREFIX may only contain letters, digits, '.', '_', '-' and '/'")
        self.bucket = bucket
        self.region = region
        self.prefix = prefix.strip("/")
        self.public_read_acl = public_read_acl
        self.client: S3ClientLike = client if client is not None else boto3.client(
            "s3", region_name=region, config=S3_CONFIG
        )

    def upload_jpeg(self, data: bytes) -> str:
        name = f"{uuid.uuid4().hex}.jpg"
        key = f"{self.prefix}/{name}" if self.prefix else name
        extra: dict[str, Any] = {"ContentType": "image/jpeg"}
        if self.public_read_acl:
            extra["ACL"] = "public-read"
        try:
            self.client.put_object(Bucket=self.bucket, Key=key, Body=data, **extra)
        except (BotoCoreError, ClientError) as exc:
            raise UploadError(str(exc)) from exc
        return f"https://{self.bucket}.s3.{self.region}.amazonaws.com/{key}"


class MemoryUploader:
    """Test double: keeps uploads in a dict."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def upload_jpeg(self, data: bytes) -> str:
        key = f"mem/{uuid.uuid4().hex}.jpg"
        self.objects[key] = data
        return f"https://example.test/{key}"
