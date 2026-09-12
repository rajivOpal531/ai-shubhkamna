import dataclasses

from app.config import Settings, load_settings


def make_settings(**overrides) -> Settings:
    """Defaults from load_settings(env={}) plus a test origin; override any field by keyword."""
    return dataclasses.replace(load_settings(env={}), allowed_origins=["https://app.example"], **overrides)
