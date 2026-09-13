import pytest

from app.config import load_settings


@pytest.mark.parametrize(
    "env_name",
    ["RATE_LIMIT_PER_MINUTE", "RATE_LIMIT_PER_IP_PER_MINUTE", "MAX_CONCURRENT_COMPOSITES"],
)
def test_zero_clamped_settings_raise(env_name):
    with pytest.raises(ValueError, match=env_name):
        load_settings(env={env_name: "0"})


def test_defaults_when_env_is_empty():
    s = load_settings(env={})
    assert s.s3_prefix == "ai-shubh"
    assert s.s3_public_read_acl is False
    assert s.s3_public_base_url == ""
    assert s.allowed_origins == []
    assert s.rate_limit_per_minute == 10
    assert s.rate_limit_per_ip_per_minute == 30
    assert s.rate_limit_storage_uri == ""
    assert s.jwt_validate_url == ""
    assert s.max_upload_bytes == 10 * 1024 * 1024
    assert s.model_name == "isnet-general-use"
    assert s.max_concurrent_composites == 2
    assert s.max_field_chars == 120
    assert s.storage_backend == "s3"
    assert s.local_storage_dir == "local-uploads"
    assert s.public_base_url == "http://localhost:8000"
    assert s.response_mode == "image"


def test_response_mode_url_parses():
    s = load_settings(env={"RESPONSE_MODE": "url"})
    assert s.response_mode == "url"


def test_response_mode_invalid_raises():
    with pytest.raises(ValueError, match="RESPONSE_MODE"):
        load_settings(env={"RESPONSE_MODE": "ftp"})


def test_response_mode_lowercases():
    s = load_settings(env={"RESPONSE_MODE": "IMAGE"})
    assert s.response_mode == "image"


def test_storage_backend_local_parses():
    s = load_settings(env={"STORAGE_BACKEND": "local"})
    assert s.storage_backend == "local"


def test_storage_backend_invalid_raises():
    with pytest.raises(ValueError, match="STORAGE_BACKEND"):
        load_settings(env={"STORAGE_BACKEND": "gcs"})


def test_public_base_url_strips_trailing_slash():
    s = load_settings(env={"PUBLIC_BASE_URL": "https://x.example/"})
    assert s.public_base_url == "https://x.example"


def test_s3_public_base_url_strips_trailing_slash():
    s = load_settings(env={"S3_PUBLIC_BASE_URL": "https://cdn.narendramodi.in/"})
    assert s.s3_public_base_url == "https://cdn.narendramodi.in"


def test_parses_env_values():
    s = load_settings(
        env={
            "AWS_REGION": "ap-south-1",
            "S3_BUCKET": "cards",
            "S3_PREFIX": "/nested/prefix/",
            "S3_PUBLIC_READ_ACL": "TRUE",
            "S3_PUBLIC_BASE_URL": "https://cdn.narendramodi.in/",
            "ALLOWED_ORIGINS": "https://a.example, https://b.example ,",
            "RATE_LIMIT_PER_MINUTE": "3",
            "RATE_LIMIT_PER_IP_PER_MINUTE": "7",
            "RATE_LIMIT_STORAGE_URI": " redis://cache:6379/0 ",
            "JWT_VALIDATE_URL": "https://api.example/validate",
            "REMBG_MODEL": "u2net",
            "MAX_CONCURRENT_COMPOSITES": "5",
            "STORAGE_BACKEND": "local",
            "LOCAL_STORAGE_DIR": "/tmp/uploads",
            "PUBLIC_BASE_URL": "https://cdn.example/",
        }
    )
    assert s.aws_region == "ap-south-1"
    assert s.s3_bucket == "cards"
    assert s.s3_prefix == "nested/prefix"
    assert s.s3_public_read_acl is True
    assert s.s3_public_base_url == "https://cdn.narendramodi.in"
    assert s.allowed_origins == ["https://a.example", "https://b.example"]
    assert s.rate_limit_per_minute == 3
    assert s.rate_limit_per_ip_per_minute == 7
    assert s.rate_limit_storage_uri == "redis://cache:6379/0"
    assert s.jwt_validate_url == "https://api.example/validate"
    assert s.model_name == "u2net"
    assert s.max_concurrent_composites == 5
    assert s.storage_backend == "local"
    assert s.local_storage_dir == "/tmp/uploads"
    assert s.public_base_url == "https://cdn.example"
    assert s.response_mode == "image"
