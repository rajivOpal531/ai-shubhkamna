import pytest
from botocore.exceptions import ClientError, NoCredentialsError

from app.storage import MemoryUploader, S3Uploader, UploadError, Uploader


class FakeS3Client:
    def __init__(self, error: Exception | None = None):
        self.calls = []
        self.error = error

    def put_object(self, **kwargs):
        if self.error is not None:
            raise self.error
        self.calls.append(kwargs)


def test_s3_uploader_puts_jpeg_and_returns_public_url():
    client = FakeS3Client()
    uploader = S3Uploader(bucket="cards", region="ap-south-1", prefix="ai-shubh", client=client)
    url = uploader.upload_jpeg(b"jpegbytes")
    assert len(client.calls) == 1
    call = client.calls[0]
    assert call["Bucket"] == "cards"
    assert call["Key"].startswith("ai-shubh/") and call["Key"].endswith(".jpg")
    assert call["Body"] == b"jpegbytes"
    assert call["ContentType"] == "image/jpeg"
    assert "ACL" not in call
    assert url == f"https://cards.s3.ap-south-1.amazonaws.com/{call['Key']}"


def test_s3_uploader_sets_public_read_acl_when_enabled():
    client = FakeS3Client()
    uploader = S3Uploader(bucket="cards", region="ap-south-1", prefix="", public_read_acl=True, client=client)
    uploader.upload_jpeg(b"x")
    call = client.calls[0]
    assert call["ACL"] == "public-read"
    assert "/" not in call["Key"], "empty prefix must not produce a leading slash"


@pytest.mark.parametrize(
    "error",
    [
        ClientError({"Error": {"Code": "AccessDenied", "Message": "nope"}}, "PutObject"),
        NoCredentialsError(),
    ],
)
def test_s3_uploader_wraps_client_errors(error):
    uploader = S3Uploader(bucket="cards", region="ap-south-1", prefix="p", client=FakeS3Client(error=error))
    with pytest.raises(UploadError):
        uploader.upload_jpeg(b"x")


@pytest.mark.parametrize(
    "bucket, region, prefix, match",
    [
        ("", "ap-south-1", "ai-shubh", "S3_BUCKET"),
        ("cards.prod", "ap-south-1", "ai-shubh", "DNS-compatible"),
        ("MyBucket", "ap-south-1", "ai-shubh", "DNS-compatible"),
        ("a_b", "ap-south-1", "ai-shubh", "DNS-compatible"),
        ("cards", "", "ai-shubh", "AWS_REGION"),
        ("cards", "ap-south-1", "bad prefix", "S3_PREFIX"),
    ],
)
def test_s3_uploader_rejects_bad_configuration(bucket, region, prefix, match):
    with pytest.raises(ValueError, match=match):
        S3Uploader(bucket=bucket, region=region, prefix=prefix, client=FakeS3Client())


def test_s3_uploader_builds_default_client_with_timeouts(monkeypatch):
    recorded = {}

    def fake_client(service_name, **kwargs):
        recorded["service_name"] = service_name
        recorded.update(kwargs)
        return FakeS3Client()

    monkeypatch.setattr("app.storage.boto3.client", fake_client)
    S3Uploader("cards", "ap-south-1")
    assert recorded["service_name"] == "s3"
    assert recorded["region_name"] == "ap-south-1"
    assert recorded["config"].connect_timeout == 5
    assert recorded["config"].read_timeout == 30
    assert recorded["config"].retries == {"max_attempts": 3, "mode": "standard"}


def test_memory_uploader_stores_bytes_and_returns_unique_urls():
    uploader = MemoryUploader()
    a = uploader.upload_jpeg(b"a")
    b = uploader.upload_jpeg(b"b")
    assert a != b
    assert set(uploader.objects.values()) == {b"a", b"b"}


# Type-checker-only conformance check: both uploaders satisfy the Uploader protocol.
_conforms: tuple[Uploader, Uploader] = (MemoryUploader(), S3Uploader("cards", "ap-south-1", client=FakeS3Client()))
