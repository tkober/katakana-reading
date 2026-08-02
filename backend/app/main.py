"""App entry point.

The backend is API-only: the Angular bundle is served by its own nginx image,
which also reverse-proxies /api here (see ``frontend/nginx.conf``). The SPA
deep-link fallback therefore lives in that nginx config, not in this process.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import db
from .api import router
from .config import cors_origins


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_db()
    yield
    await db.reset_engines()


app = FastAPI(title="Katakana Reading Practice", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
