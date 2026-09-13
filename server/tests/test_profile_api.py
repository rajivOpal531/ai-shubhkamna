import base64
import hashlib
import json
import re
import time

import jwt
import pytest
from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from fastapi.testclient import TestClient

from app.main import create_app
from tests.conftest import fake_remover, make_settings

TEST_JWT_SECRET = "test-jwt-signing-secret-at-least-32-bytes-long"
TEST_KEY = "test-profile-key-do-not-use-prod"
TEST_IV = "test-iv"

TEST_PROFILE = {
    "username": "Rajiv Ranjan",
    "nickname": "Raj",
    "email": "rajiv@example.com",
    "mobileno": "9876543210",
    "state": "Bihar",
    "constituency": "Patna Sahib",
    "district": "Patna",
    "city": "Patna",
    "gender": "M",
    "image": "https://example.com/x.jpg",
    "usertype": "citizen",
}


def _encrypt_profile(payload: dict, key_secret: str = TEST_KEY, iv_secret: str = TEST_IV) -> str:
    key = hashlib.sha256(key_secret.encode()).digest()
    iv = hashlib.sha256(iv_secret.encode()).digest()[:16]
    plaintext = json.dumps(payload).encode("utf-8")
    padder = padding.PKCS7(128).padder()
    padded = padder.update(plaintext) + padder.finalize()
    encryptor = Cipher(algorithms.AES(key), modes.CBC(iv)).encryptor()
    ciphertext = encryptor.update(padded) + encryptor.finalize()
    return base64.b64encode(ciphertext).decode("ascii")


def _make_token(
    profile: dict | None = TEST_PROFILE,
    *,
    signing_secret: str = TEST_JWT_SECRET,
    key_secret: str = TEST_KEY,
    iv_secret: str = TEST_IV,
    exp_delta: int = 3600,
    include_data: bool = True,
    raw_data: str | None = None,
) -> str:
    claims = {"exp": int(time.time()) + exp_delta}
    if raw_data is not None:
        claims["data"] = raw_data
    elif include_data:
        claims["data"] = _encrypt_profile(profile, key_secret, iv_secret)
    return jwt.encode(claims, signing_secret, algorithm="HS256")


def _profile_settings(**overrides):
    return make_settings(
        jwt_signing_secret=TEST_JWT_SECRET,
        profile_key_secret=TEST_KEY,
        profile_iv_secret=TEST_IV,
        rate_limit_per_minute=100,
        rate_limit_per_ip_per_minute=1000,
        **overrides,
    )


@pytest.fixture
def profile_client(uploader):
    app = create_app(settings=_profile_settings(), remover=fake_remover, uploader=uploader)
    with TestClient(app) as client:
        yield client


def test_profile_happy_path_returns_mapped_fields(profile_client):
    token = _make_token()
    response = profile_client.get("/profile", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200, response.text
    assert response.json() == {
        "username": "Rajiv Ranjan",
        "email": "rajiv@example.com",
        "mobileno": "9876543210",
        "state": "Bihar",
        "constituency": "Patna Sahib",
        "district": "Patna",
    }
    assert re.match(r"^[0-9a-f]{8}$", response.headers["x-request-id"])


def test_profile_missing_bearer_is_401(profile_client):
    response = profile_client.get("/profile")
    assert response.status_code == 401
    assert re.match(r"^[0-9a-f]{8}$", response.headers["x-request-id"])

    response = profile_client.get("/profile", headers={"Authorization": "Bearer "})
    assert response.status_code == 401


def test_profile_wrong_signing_secret_is_401(profile_client):
    token = _make_token(signing_secret="not-the-real-secret")
    response = profile_client.get("/profile", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


def test_profile_expired_token_is_401(profile_client):
    token = _make_token(exp_delta=-3600)
    response = profile_client.get("/profile", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401
    assert "expired" in response.json()["detail"].lower()


def test_profile_secrets_unset_is_503(uploader):
    app = create_app(settings=make_settings(rate_limit_per_ip_per_minute=1000), remover=fake_remover, uploader=uploader)
    with TestClient(app) as client:
        token = _make_token()
        response = client.get("/profile", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 503
    assert response.json()["detail"] == "Profile lookup is not configured"


def test_profile_missing_data_claim_is_422(profile_client):
    token = _make_token(include_data=False)
    response = profile_client.get("/profile", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 422


def test_profile_undecryptable_data_is_502(profile_client):
    token = _make_token(raw_data="not-valid-base64-ciphertext!!!")
    response = profile_client.get("/profile", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 502
    assert response.json()["detail"] == "Could not read profile"


def test_profile_data_decrypts_to_non_json_is_502(profile_client):
    # Build valid AES-CBC ciphertext (decryptable with the test key/iv) whose plaintext is not JSON.
    key = hashlib.sha256(TEST_KEY.encode()).digest()
    iv = hashlib.sha256(TEST_IV.encode()).digest()[:16]
    padder = padding.PKCS7(128).padder()
    padded_plain = padder.update(b"definitely not json") + padder.finalize()
    encryptor = Cipher(algorithms.AES(key), modes.CBC(iv)).encryptor()
    ciphertext = encryptor.update(padded_plain) + encryptor.finalize()
    raw_data = base64.b64encode(ciphertext).decode("ascii")

    token = _make_token(raw_data=raw_data)
    response = profile_client.get("/profile", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 502


def test_profile_cors_exposes_request_id(profile_client):
    token = _make_token()
    response = profile_client.get(
        "/profile", headers={"Authorization": f"Bearer {token}", "Origin": "https://app.example"}
    )
    assert response.status_code == 200
    assert "x-request-id" in response.headers.get("access-control-expose-headers", "").lower()


def test_non_string_data_claim_is_422(profile_client):
    token = _make_token(raw_data=None)
    # forge a token whose data claim is a number, signed with the test secret
    claims = {"exp": int(time.time()) + 3600, "data": 12345}
    bad = jwt.encode(claims, TEST_JWT_SECRET, algorithm="HS256")
    response = profile_client.get("/profile", headers={"Authorization": f"Bearer {bad}"})
    assert response.status_code == 422
    assert response.headers.get("X-Request-Id")
