from app.config import load_settings


def test_defaults_when_env_is_empty():
    s = load_settings(env={})
    assert s.s3_prefix == "ai-shubh"
    assert s.s3_public_read_acl is False
    assert s.allowed_origins == []
    assert s.rate_limit_per_minute == 10
    assert s.jwt_validate_url == ""
    assert s.max_upload_bytes == 10 * 1024 * 1024
    assert s.model_name == "isnet-general-use"


def test_parses_env_values():
    s = load_settings(
        env={
            "AWS_REGION": "ap-south-1",
            "S3_BUCKET": "cards",
            "S3_PREFIX": "/nested/prefix/",
            "S3_PUBLIC_READ_ACL": "TRUE",
            "ALLOWED_ORIGINS": "https://a.example, https://b.example ,",
            "RATE_LIMIT_PER_MINUTE": "3",
            "JWT_VALIDATE_URL": "https://api.example/validate",
            "REMBG_MODEL": "u2net",
        }
    )
    assert s.aws_region == "ap-south-1"
    assert s.s3_bucket == "cards"
    assert s.s3_prefix == "nested/prefix"
    assert s.s3_public_read_acl is True
    assert s.allowed_origins == ["https://a.example", "https://b.example"]
    assert s.rate_limit_per_minute == 3
    assert s.jwt_validate_url == "https://api.example/validate"
    assert s.model_name == "u2net"
