"""Environment-driven settings. Everything secret stays in the environment."""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping


@dataclass(frozen=True)
class Settings:
    aws_region: str
    s3_bucket: str
    s3_prefix: str
    s3_public_read_acl: bool
    allowed_origins: list[str]
    rate_limit_per_minute: int
    jwt_validate_url: str
    max_upload_bytes: int
    model_name: str


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    env = os.environ if env is None else env
    origins = [o.strip() for o in env.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]
    return Settings(
        aws_region=env.get("AWS_REGION", ""),
        s3_bucket=env.get("S3_BUCKET", ""),
        s3_prefix=env.get("S3_PREFIX", "ai-shubh").strip("/"),
        s3_public_read_acl=env.get("S3_PUBLIC_READ_ACL", "false").strip().lower() == "true",
        allowed_origins=origins,
        rate_limit_per_minute=int(env.get("RATE_LIMIT_PER_MINUTE", "10")),
        jwt_validate_url=env.get("JWT_VALIDATE_URL", "").strip(),
        max_upload_bytes=10 * 1024 * 1024,
        model_name=env.get("REMBG_MODEL", "isnet-general-use"),
    )
