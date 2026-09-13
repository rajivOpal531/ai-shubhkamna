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
    s3_public_base_url: str
    allowed_origins: list[str]
    rate_limit_per_minute: int
    rate_limit_per_ip_per_minute: int
    rate_limit_storage_uri: str
    jwt_validate_url: str
    max_upload_bytes: int
    model_name: str
    max_concurrent_composites: int
    max_field_chars: int
    storage_backend: str
    local_storage_dir: str
    public_base_url: str
    response_mode: str


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    env = os.environ if env is None else env
    origins = [o.strip() for o in env.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]
    rate_limit_per_minute = int(env.get("RATE_LIMIT_PER_MINUTE", "10"))
    rate_limit_per_ip_per_minute = int(env.get("RATE_LIMIT_PER_IP_PER_MINUTE", "30"))
    max_concurrent_composites = int(env.get("MAX_CONCURRENT_COMPOSITES", "2"))
    if rate_limit_per_minute < 1:
        raise ValueError("RATE_LIMIT_PER_MINUTE must be >= 1")
    if rate_limit_per_ip_per_minute < 1:
        raise ValueError("RATE_LIMIT_PER_IP_PER_MINUTE must be >= 1")
    if max_concurrent_composites < 1:
        raise ValueError("MAX_CONCURRENT_COMPOSITES must be >= 1")
    storage_backend = env.get("STORAGE_BACKEND", "s3").strip()
    if storage_backend not in ("s3", "local"):
        raise ValueError("STORAGE_BACKEND must be 's3' or 'local'")
    response_mode = env.get("RESPONSE_MODE", "image").strip().lower()
    if response_mode not in ("image", "url"):
        raise ValueError("RESPONSE_MODE must be 'image' or 'url'")
    return Settings(
        aws_region=env.get("AWS_REGION", ""),
        s3_bucket=env.get("S3_BUCKET", ""),
        s3_prefix=env.get("S3_PREFIX", "ai-shubh").strip("/"),
        s3_public_read_acl=env.get("S3_PUBLIC_READ_ACL", "false").strip().lower() == "true",
        s3_public_base_url=env.get("S3_PUBLIC_BASE_URL", "").strip().rstrip("/"),
        allowed_origins=origins,
        rate_limit_per_minute=rate_limit_per_minute,
        rate_limit_per_ip_per_minute=rate_limit_per_ip_per_minute,
        rate_limit_storage_uri=env.get("RATE_LIMIT_STORAGE_URI", "").strip(),
        jwt_validate_url=env.get("JWT_VALIDATE_URL", "").strip(),
        max_upload_bytes=10 * 1024 * 1024,
        model_name=env.get("REMBG_MODEL", "isnet-general-use"),
        max_concurrent_composites=max_concurrent_composites,
        max_field_chars=120,
        storage_backend=storage_backend,
        local_storage_dir=env.get("LOCAL_STORAGE_DIR", "local-uploads").strip(),
        public_base_url=env.get("PUBLIC_BASE_URL", "http://localhost:8000").strip().rstrip("/"),
        response_mode=response_mode,
    )
