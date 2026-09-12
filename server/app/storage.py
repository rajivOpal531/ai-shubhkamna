"""Where finished cards go. S3 in production, memory in tests."""
from __future__ import annotations

import uuid
from typing import Any, Protocol

import boto3
from botocore.exceptions import BotoCoreError, ClientError


class UploadError(RuntimeError):
    """The object store rejected the upload."""


class Uploader(Protocol):
    def upload_jpeg(self, data: bytes) -> str:  # returns a public URL
        ...


class S3Uploader:
    def __init__(
        self,
        bucket: str,
        region: str,
        prefix: str = "ai-shubh",
        public_read_acl: bool = False,
        client: Any | None = None,
    ) -> None:
        self.bucket = bucket
        self.region = region
        self.prefix = prefix.strip("/")
        self.public_read_acl = public_read_acl
        self.client = client or boto3.client("s3", region_name=region)

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
