"""Server-side decryption of the profile blob carried in the user JWT's `data` claim.

The encryption is a legacy scheme shared across the whole platform (one static key/IV pair
for every user), so decryption must never happen in the browser -- see GET /profile in
main.py, which is the only caller. Nothing here reads the network or the filesystem.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import json
from dataclasses import dataclass

from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes


class ProfileError(ValueError):
    """The profile blob could not be decrypted or parsed."""


def decrypt_profile(data_b64: str, key_secret: str, iv_secret: str) -> str:
    """AES-256-CBC decrypt the base64 `data` claim. Key/IV are derived by SHA-256 hashing the
    configured secrets (raw digest bytes, not hex) -- 32 bytes for the key, the first 16 of the
    digest for the IV. Returns the decrypted JSON text; raises ProfileError on any failure
    (bad base64, wrong key/IV, bad padding, non-UTF-8 plaintext)."""
    try:
        key = hashlib.sha256(key_secret.encode()).digest()
        iv = hashlib.sha256(iv_secret.encode()).digest()[:16]
        ciphertext = base64.b64decode(data_b64, validate=True)
        decryptor = Cipher(algorithms.AES(key), modes.CBC(iv)).decryptor()
        raw = decryptor.update(ciphertext) + decryptor.finalize()
        unpadder = padding.PKCS7(128).unpadder()
        plaintext = unpadder.update(raw) + unpadder.finalize()
        return plaintext.decode("utf-8")
    except (binascii.Error, ValueError) as exc:
        raise ProfileError(f"Could not decrypt profile data: {exc}") from exc


@dataclass(frozen=True)
class Profile:
    username: str = ""
    email: str = ""
    mobileno: str = ""
    state: str = ""
    constituency: str = ""
    district: str = ""


def _as_str(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return str(value)


def profile_from_claims(data_json: str) -> Profile:
    """Parse the decrypted JSON and map the fields the frontend needs. Missing keys become "";
    extra keys (usertype, image, gender, ...) are ignored; non-string values (e.g. an int
    mobileno) are coerced to str. Raises ProfileError if the text is not valid JSON or the
    top-level value is not an object."""
    try:
        parsed = json.loads(data_json)
    except json.JSONDecodeError as exc:
        raise ProfileError(f"Profile data is not valid JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise ProfileError("Profile data is not a JSON object")
    return Profile(
        username=_as_str(parsed.get("username")),
        email=_as_str(parsed.get("email")),
        mobileno=_as_str(parsed.get("mobileno")),
        state=_as_str(parsed.get("state")),
        constituency=_as_str(parsed.get("constituency")),
        district=_as_str(parsed.get("district")),
    )
