import pytest
from botocore.exceptions import ClientError

from app.storage import MemoryUploader, S3Uploader, UploadError


class FakeS3Client:
    def __init__(self, fail: bool = False):
        self.calls = []
        self.fail = fail

    def put_object(self, **kwargs):
        if self.fail:
            raise ClientError({"Error": {"Code": "AccessDenied", "Message": "nope"}}, "PutObject")
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


def test_s3_uploader_wraps_client_errors():
    uploader = S3Uploader(bucket="cards", region="ap-south-1", prefix="p", client=FakeS3Client(fail=True))
    with pytest.raises(UploadError):
        uploader.upload_jpeg(b"x")


def test_memory_uploader_stores_bytes_and_returns_unique_urls():
    uploader = MemoryUploader()
    a = uploader.upload_jpeg(b"a")
    b = uploader.upload_jpeg(b"b")
    assert a != b
    assert set(uploader.objects.values()) == {b"a", b"b"}
