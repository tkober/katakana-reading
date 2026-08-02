"""App entry point: API + static frontend serving."""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import db
from .api import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    conn = db.get_conn()
    try:
        db.init_db(conn)
    finally:
        conn.close()
    yield


app = FastAPI(title="Katakana Reading Practice", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200"],  # Angular dev server
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


class SpaStaticFiles(StaticFiles):
    """Static files with a client-side-routing fallback.

    The Angular router owns paths like /stats, which exist as no file on
    disk. Serving index.html for unknown paths is what makes a deep link or
    a reload on those routes work. Unmatched /api/* paths keep their 404 —
    a JSON client must never get an HTML page back.
    """

    async def get_response(self, path: str, scope: Any):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code == 404 and not path.startswith("api"):
                return await super().get_response("index.html", scope)
            raise


static_dir = os.environ.get("STATIC_DIR", "")
if static_dir and Path(static_dir).is_dir():
    app.mount("/", SpaStaticFiles(directory=static_dir, html=True), name="static")
