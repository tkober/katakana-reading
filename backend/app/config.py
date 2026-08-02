"""Runtime configuration, read from environment variables (and a local .env).

The Postgres connection uses two roles: an *owner* role that may run DDL (used
only at startup, to create the tables and refresh the vocabulary) and an *app*
role for everything a request does. ``DB_URL`` carries only host/port/database —
credentials and the async driver are injected per role.

Values are read at call time rather than at import: the tests point the process
at a throwaway database *after* these modules are imported (see
``tests/conftest.py``), which module-level constants would freeze out.
"""

from __future__ import annotations

import os

from dotenv import load_dotenv
from sqlalchemy.engine import URL, make_url

load_dotenv()

DEFAULT_DB_URL = "postgresql://localhost:5432/katakana"


def _role_url(user: str, password: str) -> URL:
    """Build an async SQLAlchemy URL for one role from the base DB_URL."""
    base = make_url(os.environ.get("DB_URL", DEFAULT_DB_URL))
    return base.set(
        drivername="postgresql+asyncpg",
        username=user or None,
        password=password or None,
    )


def app_database_url() -> URL:
    """The role serving requests — CRUD only, no DDL."""
    return _role_url(os.environ.get("DB_USER", ""), os.environ.get("DB_PASSWORD", ""))


def owner_database_url() -> URL:
    """The role used at startup for DDL and the seeding that follows it."""
    return _role_url(
        os.environ.get("DB_OWNER_USER", ""), os.environ.get("DB_OWNER_PASSWORD", "")
    )


def cors_origins() -> list[str]:
    """Origins allowed to call the API from a browser.

    Only relevant for requests reaching the backend *directly*: in the deployed
    setup nginx proxies /api same-origin, so no CORS check happens there. The
    default covers the Angular dev server; "*" allows any origin.
    """
    raw = os.environ.get("CORS_ORIGINS", "http://localhost:4200")
    return [o.strip() for o in raw.split(",") if o.strip()] or ["*"]
