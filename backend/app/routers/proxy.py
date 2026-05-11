from fastapi import APIRouter

# Lazy-loaded routers
router = APIRouter()


# Import routers only when needed
@router.get("/health", include_in_schema=False)
def health_check():
    return {"status": "ok"}


# Optional: add /api/chat as lazy route
# This would require dynamic import — but for now, we'll keep it simple
# and just remove chat from main.py entirely.

# For production: use FastAPI's `include_router` with `dependencies=[]`
# and wrap in try/except to skip if import fails.
