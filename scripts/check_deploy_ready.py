from __future__ import annotations

import os
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"


def exists(path: Path) -> bool:
    return path.exists() and path.stat().st_size > 0


def check_file(path: Path, label: str) -> tuple[bool, str]:
    if exists(path):
        return True, f"OK {label}: {path.relative_to(ROOT)}"
    return False, f"MISS {label}: {path.relative_to(ROOT)}"


def check_env(name: str, required_for_public: bool = True) -> tuple[bool, str]:
    value = os.environ.get(name, "").strip()
    if value:
        hidden = value if name.startswith("VITE_") or name in {"AI_PROVIDER", "YOLO_DEVICE"} else "<set>"
        return True, f"OK env {name}={hidden}"
    status = "MISS" if required_for_public else "WARN"
    return not required_for_public, f"{status} env {name}"


def main() -> int:
    checks: list[tuple[bool, str]] = []

    for path, label in [
        (FRONTEND / "package.json", "frontend package"),
        (FRONTEND / "vercel.json", "Vercel config"),
        (FRONTEND / "public" / "manifest.webmanifest", "PWA manifest"),
        (FRONTEND / "public" / "service-worker.js", "service worker"),
        (BACKEND / "requirements.txt", "backend requirements"),
        (BACKEND / "Procfile", "main API Procfile"),
        (BACKEND / "Procfile.motion", "motion API Procfile"),
        (ROOT / "render.yaml", "Render blueprint"),
        (ROOT / "DEPLOYMENT.md", "deployment guide"),
    ]:
        checks.append(check_file(path, label))

    model_names = [
        os.environ.get("ID_MODEL", "id_model.pt"),
        os.environ.get("COUNT_MODEL", "bee_motion.pt"),
    ]
    for model_name in model_names:
        checks.append(check_file(BACKEND / model_name, f"model {model_name}"))

    for name in [
        "JWT_SECRET",
        "DATABASE_URL",
        "ADMIN_EMAIL",
        "CORS_ORIGINS",
        "VITE_API_URL",
        "VITE_COUNT_API_URL",
    ]:
        checks.append(check_env(name))

    for name in ["AI_PROVIDER", "GROQ_API_KEY", "YOLO_DEVICE"]:
        checks.append(check_env(name, required_for_public=False))

    for ok, message in checks:
        print(message)

    failed = [message for ok, message in checks if not ok]
    if failed:
        print()
        print(f"Deploy readiness: {len(failed)} required check(s) missing.")
        return 1

    print()
    print("Deploy readiness: all required checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
