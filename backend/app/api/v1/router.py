"""API v1 router aggregation."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import (
    audit,
    auth,
    batch,
    chat,
    dashboard,
    evaluations,
    finance,
    projects,
    proposals,
    suppliers,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(dashboard.router)
api_router.include_router(projects.router)
api_router.include_router(proposals.router)
api_router.include_router(evaluations.router)
api_router.include_router(suppliers.router)
api_router.include_router(finance.router)
api_router.include_router(chat.router)
api_router.include_router(audit.router)
api_router.include_router(batch.router)
