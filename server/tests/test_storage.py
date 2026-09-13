from pathlib import Path

import pytest
from botocore.exceptions import ClientError, NoCredentialsError

from app.storage import LocalUploader, MemoryUploader, S3Uploader, UploadError, Uploader


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


def test_s3_uploader_returns_cdn_url_when_public_base_url_set():
    client = FakeS3Client()
    uploader = S3Uploader(
        bucket="cards",
        region="ap-south-1",
        prefix="shubhkamna2026",
        public_base_url="https://cdn.narendramodi.in/",
        client=client,
    )
    url = uploader.upload_jpeg(b"jpegbytes")
    call = client.calls[0]
    assert call["Key"].startswith("shubhkamna2026/")
    assert url.startswith("https://cdn.narendramodi.in/shubhkamna2026/")
    assert url.endswith(".jpg")
    assert "s3.amazonaws.com" not in url


def test_s3_uploader_uses_virtual_hosted_url_when_public_base_url_empty():
    client = FakeS3Client()
    uploader = S3Uploader(
        bucket="cards",
        region="ap-south-1",
        prefix="ai-shubh",
        public_base_url="",
        client=client,
    )
    url = uploader.upload_jpeg(b"jpegbytes")
    call = client.calls[0]
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


def test_local_uploader_writes_file_and_returns_url(tmp_path):
    directory = tmp_path / "uploads"
    uploader = LocalUploader(directory, "http://localhost:8000")
    url = uploader.upload_jpeg(b"jpegbytes")
    assert url.startswith("http://localhost:8000/uploads/")
    assert url.endswith(".jpg")
    name = url.rsplit("/", 1)[-1]
    assert (directory / name).read_bytes() == b"jpegbytes"


def test_local_uploader_two_uploads_produce_different_urls(tmp_path):
    uploader = LocalUploader(tmp_path / "uploads", "http://localhost:8000")
    a = uploader.upload_jpeg(b"a")
    b = uploader.upload_jpeg(b"b")
    assert a != b


def test_local_uploader_creates_directory_if_missing(tmp_path):
    directory = tmp_path / "does" / "not" / "exist"
    assert not directory.exists()
    LocalUploader(directory, "http://localhost:8000")
    assert directory.is_dir()


def test_local_uploader_strips_trailing_slash_from_base_url(tmp_path):
    uploader = LocalUploader(tmp_path / "uploads", "http://localhost:8000/")
    url = uploader.upload_jpeg(b"x")
    assert url.startswith("http://localhost:8000/uploads/")
    assert "//uploads" not in url.replace("http://", "")


def test_local_uploader_raises_upload_error_on_write_failure(monkeypatch, tmp_path):
    uploader = LocalUploader(tmp_path / "uploads", "http://localhost:8000")

    def boom(self, data):
        raise OSError("disk full")

    monkeypatch.setattr(Path, "write_bytes", boom)
    with pytest.raises(UploadError):
        uploader.upload_jpeg(b"x")


# Type-checker-only conformance check: all uploaders satisfy the Uploader protocol.
_conforms: tuple[Uploader, Uploader, Uploader] = (
    MemoryUploader(),
    S3Uploader("cards", "ap-south-1", client=FakeS3Client()),
    LocalUploader(Path("."), "http://localhost:8000"),
)


def test_s3_uploader_accepts_dotted_bucket_name():
    class FakeClient:
        def put_object(self, **kw):
            self.kw = kw

    client = FakeClient()
    up = S3Uploader(
        bucket="s3.narendramodi.in",
        region="ap-southeast-1",
        prefix="shubhkamna2026",
        public_base_url="https://s3.narendramodi.in",
        client=client,
    )
    url = up.upload_jpeg(b"data")
    assert url.startswith("https://s3.narendramodi.in/shubhkamna2026/")
    assert client.kw["CacheControl"] == "public, max-age=31536000, immutable"
