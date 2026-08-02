"""App entry point: API + static frontend serving."""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

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

static_dir = os.environ.get("STATIC_DIR", "")
if static_dir and Path(static_dir).is_dir():
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
