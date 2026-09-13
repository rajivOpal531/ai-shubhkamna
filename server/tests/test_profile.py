import base64
import hashlib
import json

import pytest
from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from app.profile import Profile, ProfileError, decrypt_profile, profile_from_claims

TEST_KEY = "test-profile-key-do-not-use-prod"
TEST_IV = "test-iv"


def encrypt_profile(payload: dict, key_secret: str = TEST_KEY, iv_secret: str = TEST_IV) -> str:
    """Test-only mirror of the real encryption: same key/IV derivation as decrypt_profile."""
    key = hashlib.sha256(key_secret.encode()).digest()
    iv = hashlib.sha256(iv_secret.encode()).digest()[:16]
    plaintext = json.dumps(payload).encode("utf-8")
    padder = padding.PKCS7(128).padder()
    padded = padder.update(plaintext) + padder.finalize()
    encryptor = Cipher(algorithms.AES(key), modes.CBC(iv)).encryptor()
    ciphertext = encryptor.update(padded) + encryptor.finalize()
    return base64.b64encode(ciphertext).decode("ascii")


def test_round_trip_decrypts_to_original_json():
    payload = {"username": "Rajiv Ranjan", "state": "Bihar", "mobileno": 9876543210}
    blob = encrypt_profile(payload)
    decrypted = decrypt_profile(blob, TEST_KEY, TEST_IV)
    assert json.loads(decrypted) == payload


def test_decrypt_with_wrong_key_raises_profile_error():
    blob = encrypt_profile({"username": "x"})
    with pytest.raises(ProfileError):
        decrypt_profile(blob, "wrong-key", TEST_IV)


def test_decrypt_garbage_raises_profile_error():
    with pytest.raises(ProfileError):
        decrypt_profile("not-valid-base64!!!", TEST_KEY, TEST_IV)


def test_decrypt_valid_base64_but_not_aes_ciphertext_raises_profile_error():
    # Valid base64, but wrong length / not a multiple of the block size once decoded oddly,
    # or padding won't validate against these key/iv -- either way ProfileError, not a crash.
    with pytest.raises(ProfileError):
        decrypt_profile(base64.b64encode(b"short").decode(), TEST_KEY, TEST_IV)


def test_profile_from_claims_maps_known_fields():
    payload = {
        "username": "Rajiv",
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
        "exp": 1234567890,
    }
    profile = profile_from_claims(json.dumps(payload))
    assert profile == Profile(
        username="Rajiv",
        email="rajiv@example.com",
        mobileno="9876543210",
        state="Bihar",
        constituency="Patna Sahib",
        district="Patna",
    )


def test_profile_from_claims_tolerates_missing_keys():
    profile = profile_from_claims(json.dumps({"username": "Only Username"}))
    assert profile == Profile(username="Only Username")


def test_profile_from_claims_coerces_int_mobileno_to_str():
    profile = profile_from_claims(json.dumps({"mobileno": 9876543210}))
    assert profile.mobileno == "9876543210"


def test_profile_from_claims_on_non_json_raises_profile_error():
    with pytest.raises(ProfileError):
        profile_from_claims("not json at all")


def test_profile_from_claims_on_json_array_raises_profile_error():
    with pytest.raises(ProfileError):
        profile_from_claims("[1, 2, 3]")
