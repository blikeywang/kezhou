from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .config import settings
from .routers import auth, symbols, analysis, watchlists, collect, billing, admin

app = FastAPI(
    title=settings.APP_NAME,
    version="0.1.0",
    description="刻舟求剑 Historical K-Line Pattern API — skeleton. See docs/BUILD_SPEC.md.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

for r in (auth, symbols, analysis, watchlists, collect, billing, admin):
    app.include_router(r.router)


@app.get("/health", tags=["meta"])
def health():
    return {"ok": True, "name": settings.APP_NAME, "env": settings.ENV}
