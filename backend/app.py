from flask import Flask, request, jsonify, send_file
from flask_sqlalchemy import SQLAlchemy
from flask_bcrypt import Bcrypt
from flask_jwt_extended import (
    JWTManager, create_access_token,
    jwt_required, get_jwt_identity
)
from flask_cors import CORS
from datetime import datetime, timedelta
from ultralytics import YOLO
import cv2
import numpy as np
import os
import tempfile
import base64
import time
import json

################3
import torch
import functools

# ── PYTORCH 2.6 SECURITY FIX ──────────────────────────────
# This overrides the default behavior of torch.load globally.
# This is necessary because YOLO models use many custom classes 
# that PyTorch 2.6 blocks by default.
# Only use this if you trust your .pt files!
torch.load = functools.partial(torch.load, weights_only=False)
# ──────────────────────────────────────────────────────────

from flask import Flask, request, jsonify, send_file
# ... (rest of your imports)
from ultralytics import YOLO
import cv2
import numpy as np
# ... and so on

def parse_cors_origins():
    raw = os.environ.get("CORS_ORIGINS", "")
    origins = [origin.strip() for origin in raw.split(",") if origin.strip()]
    return origins or [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://*.vercel.app",
        "https://*.netlify.app",
        "https://*.trycloudflare.com",
    ]


app = Flask(__name__)
CORS(app, origins=parse_cors_origins())

database_url = os.environ.get("DATABASE_URL", "sqlite:///beecount.db")
if database_url.startswith("postgres://"):
    database_url = database_url.replace("postgres://", "postgresql://", 1)
app.config["SQLALCHEMY_DATABASE_URI"] = database_url
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["JWT_SECRET_KEY"] = os.environ.get("JWT_SECRET", "dev-only-change-this-hivegate-ai-jwt-secret")
app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(hours=24)
app.config["MAX_CONTENT_LENGTH"] = 1024 * 1024 * 1024  # 1GB max upload

db     = SQLAlchemy(app)
bcrypt = Bcrypt(app)
jwt    = JWTManager(app)
LIVE_SESSIONS = {}
LIVE_SESSION_HISTORY_LIMIT = 240
DEFAULT_LIVE_NODE_ID = "phone-1"
AI_PROVIDER = os.environ.get("AI_PROVIDER", "openai").strip().lower()
DEFAULT_OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-5.2")
DEFAULT_GROQ_MODEL = os.environ.get("GROQ_MODEL", "groq/compound-mini")
GROQ_BASE_URL = os.environ.get("GROQ_BASE_URL", "https://api.groq.com/openai/v1")
DEFAULT_GROQ_MODELS = [
    ("groq/compound-mini", "Compound Mini", "Recommended for this app: high TPM limit for project-data answers."),
    ("groq/compound", "Compound", "Backup option with the same high TPM limit for heavier report questions."),
    ("meta-llama/llama-4-scout-17b-16e-instruct", "Llama 4 Scout", "Use after slimming context; lower TPM than Compound but stronger than small models."),
]
GROQ_AGENT_SAFE_DEFAULT_MODEL = "groq/compound-mini"
GROQ_AGENT_SAFE_MODEL_IDS = {model_id for model_id, _, _ in DEFAULT_GROQ_MODELS}
GROQ_AGENT_LOW_TPM_MODELS = {
    "allam-2-7b",
    "llama-3.1-8b-instant",
    "llama-3.3-70b-versatile",
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "qwen/qwen3-32b",
}
ADMIN_EMAILS = {
    email.strip().lower()
    for email in os.environ.get("ADMIN_EMAIL", "").split(",")
    if email.strip()
}

# ── MODEL PATHS ─────────────────────────────────────────
# Place your .pt files in the backend/ folder
ID_MODEL_PATH    = os.environ.get("ID_MODEL",    "id_model.pt")
COUNT_MODEL_PATH = os.environ.get("COUNT_MODEL", "bee_motion.pt")

# Lazy load models — only load when first request comes in
_id_model    = None
_count_model = None
YOLO_DEVICE = os.environ.get("YOLO_DEVICE", "cuda:0" if torch.cuda.is_available() else "cpu")


def _prepare_model(model_path):
    model = YOLO(model_path)
    model.to(YOLO_DEVICE)
    app.logger.info("Loaded YOLO model %s on %s", model_path, YOLO_DEVICE)
    return model

def get_id_model():
    global _id_model
    if _id_model is None:
        _id_model = _prepare_model(ID_MODEL_PATH)
    return _id_model

def get_count_model():
    global _count_model
    if _count_model is None:
        _count_model = _prepare_model(COUNT_MODEL_PATH)
    return _count_model

# ── DB MODELS ────────────────────────────────────────────
class User(db.Model):
    id        = db.Column(db.Integer, primary_key=True)
    username  = db.Column(db.String(80),  unique=True, nullable=False)
    email     = db.Column(db.String(120), unique=True, nullable=False)
    password  = db.Column(db.String(200), nullable=False)
    hive_name = db.Column(db.String(100), default="My Hive")
    created_at= db.Column(db.DateTime, default=datetime.utcnow)

class CountLog(db.Model):
    id        = db.Column(db.Integer, primary_key=True)
    user_id   = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    count_in  = db.Column(db.Integer, default=0)
    count_out = db.Column(db.Integer, default=0)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    hive_name = db.Column(db.String(100), default="My Hive")

class SessionReport(db.Model):
    id           = db.Column(db.Integer, primary_key=True)
    user_id      = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    count_log_id = db.Column(db.Integer, db.ForeignKey("count_log.id"), nullable=False, unique=True)
    title        = db.Column(db.String(160), nullable=False)
    summary      = db.Column(db.Text, nullable=False)
    status_label = db.Column(db.String(80), default="Review")
    recommendation = db.Column(db.Text, default="")
    payload      = db.Column(db.JSON, nullable=False)
    created_at   = db.Column(db.DateTime, default=datetime.utcnow)

with app.app_context():
    db.create_all()


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "status": "online",
        "service": "main-backend",
        "port": int(os.environ.get("PORT", 5000)),
        "time": datetime.utcnow().isoformat() + "Z",
    })


def is_admin_user(user):
    if not user:
        return False
    email = (user.email or "").strip().lower()
    if ADMIN_EMAILS:
        return email in ADMIN_EMAILS
    first_user = User.query.order_by(User.id.asc()).first()
    return bool(first_user and user.id == first_user.id)

def current_user_or_none():
    try:
        return User.query.get(int(get_jwt_identity()))
    except (TypeError, ValueError):
        return None

def require_admin_user():
    user = current_user_or_none()
    if not is_admin_user(user):
        return None, (jsonify({"error": "Admin access required"}), 403)
    return user, None

def serialize_admin_user(user):
    logs = CountLog.query.filter_by(user_id=user.id)
    reports = SessionReport.query.filter_by(user_id=user.id)
    total_in = db.session.query(db.func.sum(CountLog.count_in)).filter(CountLog.user_id == user.id).scalar() or 0
    total_out = db.session.query(db.func.sum(CountLog.count_out)).filter(CountLog.user_id == user.id).scalar() or 0
    latest_log = logs.order_by(CountLog.timestamp.desc(), CountLog.id.desc()).first()
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "hive_name": user.hive_name,
        "created_at": user.created_at.isoformat() + "Z",
        "is_admin": is_admin_user(user),
        "log_count": logs.count(),
        "report_count": reports.count(),
        "total_in": int(total_in),
        "total_out": int(total_out),
        "latest_count_at": latest_log.timestamp.isoformat() + "Z" if latest_log else None,
    }

def serialize_admin_count_log(log):
    data = serialize_count_log(log)
    user = User.query.get(log.user_id)
    data["user_id"] = log.user_id
    data["username"] = user.username if user else "Deleted user"
    data["email"] = user.email if user else ""
    return data

def read_recent_backend_errors(limit=6):
    paths = [
        os.path.join(app.root_path, "backend.err.log"),
        os.path.join(os.path.dirname(app.root_path), "dev-runner.err.log"),
    ]
    lines = []
    for path in paths:
        if not os.path.exists(path):
            continue
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as handle:
                lines.extend([line.strip() for line in handle.readlines() if line.strip()])
        except OSError:
            continue
    error_lines = [
        line for line in lines
        if "error" in line.lower() or "exception" in line.lower() or "traceback" in line.lower()
    ]
    return error_lines[-limit:]

# ── AUTH ─────────────────────────────────────────────────
@app.route("/api/register", methods=["POST"])
def register():
    d = request.json
    if not d or not all(k in d for k in ["username","email","password"]):
        return jsonify({"error": "Missing fields"}), 400
    if User.query.filter_by(email=d["email"]).first():
        return jsonify({"error": "Email already registered"}), 409
    if User.query.filter_by(username=d["username"]).first():
        return jsonify({"error": "Username already taken"}), 409
    hashed = bcrypt.generate_password_hash(d["password"]).decode("utf-8")
    user   = User(username=d["username"], email=d["email"],
                  password=hashed, hive_name=d.get("hive_name","My Hive"))
    db.session.add(user)
    db.session.commit()
    return jsonify({"message": "Registered successfully"}), 201

@app.route("/api/login", methods=["POST"])
def login():
    d    = request.json
    user = User.query.filter_by(email=d.get("email")).first()
    if not user or not bcrypt.check_password_hash(user.password, d.get("password","")):
        return jsonify({"error": "Invalid email or password"}), 401
    token = create_access_token(identity=str(user.id))
    return jsonify({"token": token, "username": user.username,
                    "hive_name": user.hive_name, "user_id": user.id,
                    "email": user.email, "is_admin": is_admin_user(user)})

@app.route("/api/me", methods=["GET"])
@jwt_required()
def me():
    user = User.query.get(int(get_jwt_identity()))
    return jsonify({"username": user.username, "email": user.email,
                    "hive_name": user.hive_name,
                    "is_admin": is_admin_user(user)})

# ── DASHBOARD DATA ────────────────────────────────────────
@app.route("/api/counts/today", methods=["GET"])
@jwt_required()
def today():
    uid   = int(get_jwt_identity())
    today = datetime.utcnow().date()
    logs  = CountLog.query.filter(
        CountLog.user_id == uid,
        db.func.date(CountLog.timestamp) == today
    ).all()
    ti = sum(l.count_in  for l in logs)
    to = sum(l.count_out for l in logs)
    return jsonify({"date": str(today), "total_in": ti,
                    "total_out": to, "net": ti - to})

@app.route("/api/counts/daily", methods=["GET"])
@jwt_required()
def daily():
    uid   = int(get_jwt_identity())
    days  = int(request.args.get("days", 30))
    since = datetime.utcnow() - timedelta(days=days)
    logs  = CountLog.query.filter(
        CountLog.user_id == uid,
        CountLog.timestamp >= since
    ).order_by(CountLog.timestamp).all()
    data = {}
    for l in logs:
        d = l.timestamp.strftime("%Y-%m-%d")
        data.setdefault(d, {"in":0,"out":0})
        data[d]["in"]  += l.count_in
        data[d]["out"] += l.count_out
    return jsonify([{"date":k,"in":v["in"],"out":v["out"]}
                    for k,v in sorted(data.items())])

@app.route("/api/counts/monthly", methods=["GET"])
@jwt_required()
def monthly():
    uid   = int(get_jwt_identity())
    since = datetime.utcnow() - timedelta(days=365)
    logs  = CountLog.query.filter(
        CountLog.user_id == uid,
        CountLog.timestamp >= since
    ).order_by(CountLog.timestamp).all()
    data = {}
    for l in logs:
        m = l.timestamp.strftime("%Y-%m")
        data.setdefault(m, {"in":0,"out":0})
        data[m]["in"]  += l.count_in
        data[m]["out"] += l.count_out
    return jsonify([{"month":k,"in":v["in"],"out":v["out"]}
                    for k,v in sorted(data.items())])

@app.route("/api/counts/yearly", methods=["GET"])
@jwt_required()
def yearly():
    uid  = int(get_jwt_identity())
    logs = CountLog.query.filter(CountLog.user_id == uid).all()
    data = {}
    for l in logs:
        y = l.timestamp.strftime("%Y")
        data.setdefault(y, {"in":0,"out":0})
        data[y]["in"]  += l.count_in
        data[y]["out"] += l.count_out
    return jsonify([{"year":k,"in":v["in"],"out":v["out"]}
                    for k,v in sorted(data.items())])


def serialize_count_log(log):
    return {
        "id": log.id,
        "count_in": log.count_in,
        "count_out": log.count_out,
        "net": log.count_in - log.count_out,
        "timestamp": log.timestamp.isoformat() + "Z",
        "date": log.timestamp.strftime("%Y-%m-%d"),
        "time": log.timestamp.strftime("%H:%M:%S"),
        "hive_name": log.hive_name,
    }


def _parse_iso_timestamp(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).replace(tzinfo=None)
    except (TypeError, ValueError):
        return None


def _format_duration(seconds):
    seconds = max(0, int(seconds or 0))
    minutes, remainder = divmod(seconds, 60)
    if minutes:
        return f"{minutes} min {remainder} sec"
    return f"{remainder} sec"


def _activity_level(total_crossings):
    if total_crossings >= 80:
        return "High activity"
    if total_crossings >= 25:
        return "Moderate activity"
    if total_crossings > 0:
        return "Low activity"
    return "No activity captured"


def _balance_note(count_in, count_out):
    total = count_in + count_out
    net = count_in - count_out
    if total == 0:
        return "No entrance crossings were saved in this session."
    if abs(net) <= max(2, round(total * 0.15)):
        return "Inbound and outbound movement were broadly balanced."
    if net > 0:
        return "More bees entered than left during this saved window."
    return "More bees left than entered during this saved window."


def _confidence_note(session):
    mode = session.get("mode", "motion")
    detections = int(session.get("detections", 0) or 0)
    verified = int(session.get("verified", 0) or 0)
    frames = len(session.get("history", []))
    if mode == "hybrid" and verified:
        return f"Hybrid mode had {verified} YOLO-verified motion checks across {frames} published points."
    if detections:
        return f"Motion mode detected activity in the latest frame set; {frames} timeline points were recorded."
    return f"The report is based on saved crossing counts and {frames} timeline points; review the camera view if accuracy is important."


def _farmer_recommendation(count_in, count_out, session):
    total = count_in + count_out
    net = count_in - count_out
    if total == 0:
        return "Keep the phone aimed at the hive entrance and run another session during active daylight hours."
    if abs(net) > max(5, round(total * 0.35)):
        return "Review the entrance video and check whether the hive-side direction is correct before comparing this session with future records."
    if session.get("active"):
        return "Continue monitoring until the observation window is long enough, then save another report for comparison."
    return "Use this report as a baseline and compare it with the next saved session from the same hive."


def generate_farmer_report_payload(log, session):
    history = session.get("history", []) if session else []
    first_time = _parse_iso_timestamp(history[0].get("timestamp")) if history else None
    last_time = _parse_iso_timestamp(history[-1].get("timestamp")) if history else None
    duration_seconds = int((last_time - first_time).total_seconds()) if first_time and last_time else 0
    count_in = int(log.count_in or 0)
    count_out = int(log.count_out or 0)
    net = count_in - count_out
    total = count_in + count_out
    activity = _activity_level(total)
    balance = _balance_note(count_in, count_out)
    confidence = _confidence_note(session or {})
    recommendation = _farmer_recommendation(count_in, count_out, session or {})
    hive_name = log.hive_name or (session or {}).get("hive_label", "My Hive")

    timeline = [
        {
            "timestamp": point.get("timestamp"),
            "time": point.get("time"),
            "in": int(point.get("in", 0) or 0),
            "out": int(point.get("out", 0) or 0),
            "net": int(point.get("net", 0) or 0),
            "detections": int(point.get("detections", 0) or 0),
            "verified": int(point.get("verified", 0) or 0),
        }
        for point in history
    ]

    summary = (
        f"{hive_name} recorded {count_in} inbound and {count_out} outbound crossings "
        f"({net:+d} net) during this saved session. {balance}"
    )

    return {
        "title": f"{hive_name} Farmer Activity Report",
        "summary": summary,
        "status_label": activity,
        "recommendation": recommendation,
        "metrics": {
            "count_in": count_in,
            "count_out": count_out,
            "net": net,
            "total_crossings": total,
            "duration_seconds": duration_seconds,
            "duration_label": _format_duration(duration_seconds),
            "detections": int((session or {}).get("detections", 0) or 0),
            "verified": int((session or {}).get("verified", 0) or 0),
            "timeline_points": len(timeline),
        },
        "context": {
            "hive_name": hive_name,
            "node_id": (session or {}).get("node_id", DEFAULT_LIVE_NODE_ID),
            "device_label": (session or {}).get("device_label", "Phone camera"),
            "mode": (session or {}).get("mode", "motion"),
            "sensitivity": (session or {}).get("sensitivity", "normal"),
            "hive_side": (session or {}).get("hive_side", "unknown"),
            "saved_at": log.timestamp.isoformat() + "Z",
        },
        "observations": [
            balance,
            confidence,
            f"Activity level: {activity.lower()}.",
        ],
        "timeline": timeline,
    }


def get_or_create_session_report(uid, log, session):
    report = SessionReport.query.filter_by(user_id=uid, count_log_id=log.id).first()
    if report:
        return report

    payload = generate_farmer_report_payload(log, session or {})
    report = SessionReport(
        user_id=uid,
        count_log_id=log.id,
        title=payload["title"],
        summary=payload["summary"],
        status_label=payload["status_label"],
        recommendation=payload["recommendation"],
        payload=payload,
    )
    db.session.add(report)
    db.session.commit()
    return report


def serialize_report(report, include_timeline=True):
    payload = report.payload or {}
    metrics = payload.get("metrics", {})
    context = payload.get("context", {})
    data = {
        "id": report.id,
        "count_log_id": report.count_log_id,
        "title": report.title,
        "summary": report.summary,
        "status_label": report.status_label,
        "recommendation": report.recommendation,
        "created_at": report.created_at.isoformat() + "Z",
        "metrics": metrics,
        "context": context,
        "observations": payload.get("observations", []),
    }
    if include_timeline:
        data["timeline"] = payload.get("timeline", [])
    return data


@app.route("/api/counts/recent", methods=["GET"])
@jwt_required()
def recent_counts():
    uid = int(get_jwt_identity())
    limit = min(max(int(request.args.get("limit", 20)), 1), 100)
    logs = CountLog.query.filter_by(user_id=uid).order_by(CountLog.timestamp.desc(), CountLog.id.desc()).limit(limit).all()
    total = CountLog.query.filter_by(user_id=uid).count()
    return jsonify({
        "total": total,
        "records": [serialize_count_log(log) for log in logs],
    })


@app.route("/api/counts/<int:log_id>", methods=["DELETE"])
@jwt_required()
def delete_count(log_id):
    uid = int(get_jwt_identity())
    log = CountLog.query.filter_by(id=log_id, user_id=uid).first()
    if not log:
        return jsonify({"error": "Count record not found"}), 404
    db.session.delete(log)
    db.session.commit()

    for session in get_user_live_sessions(uid).values():
        if session.get("last_saved_log_id") == log_id:
            session.pop("last_saved_signature", None)
            session.pop("last_saved_log_id", None)
            session.pop("last_saved_at", None)

    return jsonify({"message": "Count record deleted", "id": log_id})


@app.route("/api/counts", methods=["DELETE"])
@jwt_required()
def clear_counts():
    uid = int(get_jwt_identity())
    deleted = CountLog.query.filter_by(user_id=uid).delete()
    db.session.commit()

    for session in get_user_live_sessions(uid).values():
        session.pop("last_saved_signature", None)
        session.pop("last_saved_log_id", None)
        session.pop("last_saved_at", None)

    return jsonify({"message": "Count history cleared", "deleted": deleted})


@app.route("/api/counts/upload", methods=["POST"])
@jwt_required()
def upload_counts():
    uid = int(get_jwt_identity())
    d   = request.json or {}
    log = CountLog(user_id=uid, count_in=d.get("count_in",0),
                   count_out=d.get("count_out",0),
                   hive_name=d.get("hive_name","My Hive"))
    db.session.add(log)
    db.session.commit()
    return jsonify({"message":"Saved","id":log.id}), 201


@app.route("/api/live/session", methods=["POST"])
@jwt_required()
def update_live_session():
    uid = int(get_jwt_identity())
    now = datetime.utcnow()
    payload = request.form if request.form else (request.get_json(silent=True) or {})
    node_id = normalize_live_node_id(payload.get("node_id"))
    incoming_hive_label = (payload.get("hive_label") or "").strip()[:80]
    sessions = get_user_live_sessions(uid)
    session = sessions.setdefault(node_id, {
        "history": [],
        "snapshot_b64": None,
        "snapshot_type": "image/jpeg",
        "node_id": node_id,
        "hive_label": incoming_hive_label or "Hive 1",
        "label_locked": False,
    })
    if incoming_hive_label and not session.get("label_locked"):
        session["hive_label"] = incoming_hive_label

    snapshot = request.files.get("snapshot") if request.files else None
    if snapshot is not None:
        session["snapshot_b64"] = base64.b64encode(snapshot.read()).decode("utf-8")
        session["snapshot_type"] = snapshot.mimetype or "image/jpeg"

    def as_int(key, default=0):
        try:
            return int(payload.get(key, default))
        except (TypeError, ValueError):
            return default

    point = {
        "timestamp": now.isoformat() + "Z",
        "time": now.strftime("%H:%M:%S"),
        "in": as_int("count_in"),
        "out": as_int("count_out"),
        "net": as_int("count_in") - as_int("count_out"),
        "detections": as_int("detections"),
        "verified": as_int("verified"),
        "mode": payload.get("mode", "motion"),
        "sensitivity": payload.get("sensitivity", "normal"),
        "line": payload.get("line", ""),
        "hive_side": payload.get("hive_side", ""),
        "node_id": node_id,
        "hive_label": session.get("hive_label", "Hive 1"),
    }
    session.update({
        **point,
        "node_id": node_id,
        "hive_label": point["hive_label"],
        "device_label": payload.get("device_label", "Phone camera"),
        "updated_at": point["timestamp"],
        "updated_at_ms": int(time.time() * 1000),
        "status": payload.get("status", "live"),
    })
    session["history"].append(point)
    session["history"] = session["history"][-LIVE_SESSION_HISTORY_LIMIT:]

    return jsonify({"message": "Live session updated", "point": point})


@app.route("/api/live/session", methods=["GET"])
@jwt_required()
def get_live_session():
    uid = int(get_jwt_identity())
    node_id, session = select_live_session(uid, request.args.get("node_id"))
    if not session:
        return jsonify({
            "node_id": node_id,
            "active": False,
            "history": [],
            "snapshot": None,
        })

    return jsonify(serialize_live_session(node_id, session))


@app.route("/api/live/sessions", methods=["GET"])
@jwt_required()
def get_live_sessions():
    uid = int(get_jwt_identity())
    sessions = get_user_live_sessions(uid)
    serialized = [
        serialize_live_session(node_id, session, include_snapshot=False)
        for node_id, session in sessions.items()
    ]
    serialized.sort(key=lambda item: item.get("updated_at") or "", reverse=True)
    return jsonify({"sessions": serialized})


@app.route("/api/live/session/rename", methods=["POST"])
@jwt_required()
def rename_live_session():
    uid = int(get_jwt_identity())
    payload = request.get_json(silent=True) or {}
    node_id = normalize_live_node_id(payload.get("node_id"))
    hive_label = (payload.get("hive_label") or "").strip()[:80]
    if not hive_label:
        return jsonify({"error": "Hive name is required"}), 400

    sessions = get_user_live_sessions(uid)
    session = sessions.get(node_id)
    if not session:
        return jsonify({"error": "Live node not found"}), 404

    session["hive_label"] = hive_label
    session["label_locked"] = True
    for point in session.get("history", [])[-10:]:
        point["hive_label"] = hive_label

    return jsonify({"message": "Live node renamed", "node_id": node_id, "hive_label": hive_label})


def normalize_live_node_id(value):
    raw = str(value or DEFAULT_LIVE_NODE_ID).strip().lower()
    cleaned = "".join(ch for ch in raw if ch.isalnum() or ch in ("-", "_"))
    return (cleaned or DEFAULT_LIVE_NODE_ID)[:48]


def get_user_live_sessions(uid):
    sessions = LIVE_SESSIONS.setdefault(uid, {})
    if sessions and "history" in sessions:
        LIVE_SESSIONS[uid] = {DEFAULT_LIVE_NODE_ID: sessions}
        sessions = LIVE_SESSIONS[uid]
    return sessions


def select_live_session(uid, requested_node_id=None):
    sessions = get_user_live_sessions(uid)
    if not sessions:
        return None, None
    if requested_node_id:
        node_id = normalize_live_node_id(requested_node_id)
        return node_id, sessions.get(node_id)
    active = sorted(
        sessions.items(),
        key=lambda item: item[1].get("updated_at_ms", 0),
        reverse=True,
    )
    return active[0]


def serialize_live_session(node_id, session, include_snapshot=True):
    age_ms = int(time.time() * 1000) - session.get("updated_at_ms", 0)
    snapshot = None
    if include_snapshot and session.get("snapshot_b64"):
        snapshot = f"data:{session.get('snapshot_type', 'image/jpeg')};base64,{session['snapshot_b64']}"

    return {
        "node_id": node_id,
        "hive_label": session.get("hive_label", "Hive 1"),
        "device_label": session.get("device_label", "Phone camera"),
        "active": age_ms < 10000,
        "age_ms": age_ms,
        "updated_at": session.get("updated_at"),
        "status": session.get("status", "live"),
        "count_in": session.get("in", 0),
        "count_out": session.get("out", 0),
        "net": session.get("net", 0),
        "detections": session.get("detections", 0),
        "verified": session.get("verified", 0),
        "mode": session.get("mode", "motion"),
        "sensitivity": session.get("sensitivity", "normal"),
        "line": session.get("line", ""),
        "hive_side": session.get("hive_side", ""),
        "snapshot": snapshot,
        "history": session.get("history", []),
        "saved": session.get("last_saved_signature") == _live_session_signature(session),
        "last_saved_at": session.get("last_saved_at"),
        "last_saved_log_id": session.get("last_saved_log_id"),
    }


def _live_session_signature(session):
    return f"{session.get('updated_at', '')}:{session.get('in', 0)}:{session.get('out', 0)}"


def _parse_live_timestamp(value):
    if not value:
        return datetime.utcnow()
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.replace(tzinfo=None)
    except (TypeError, ValueError):
        return datetime.utcnow()


@app.route("/api/live/session/save", methods=["POST"])
@jwt_required()
def save_live_session():
    uid = int(get_jwt_identity())
    payload = request.get_json(silent=True) or request.form or {}
    _, session = select_live_session(uid, payload.get("node_id") or request.args.get("node_id"))
    if not session or not session.get("history"):
        return jsonify({"error": "No live session is available to save."}), 400

    signature = _live_session_signature(session)
    if session.get("last_saved_signature") == signature:
        log = CountLog.query.filter_by(id=session.get("last_saved_log_id"), user_id=uid).first()
        report = get_or_create_session_report(uid, log, session) if log else None
        return jsonify({
            "message": "Live session was already saved.",
            "already_saved": True,
            "id": session.get("last_saved_log_id"),
            "report": serialize_report(report, include_timeline=False) if report else None,
        })

    user = User.query.get(uid)
    log = CountLog(
        user_id=uid,
        count_in=int(session.get("in", 0) or 0),
        count_out=int(session.get("out", 0) or 0),
        timestamp=_parse_live_timestamp(session.get("updated_at")),
        hive_name=session.get("hive_label") or (user.hive_name if user else "My Hive"),
    )
    db.session.add(log)
    db.session.commit()

    session["last_saved_signature"] = signature
    session["last_saved_log_id"] = log.id
    session["last_saved_at"] = datetime.utcnow().isoformat() + "Z"
    report = get_or_create_session_report(uid, log, session)

    return jsonify({
        "message": "Live session saved.",
        "already_saved": False,
        "id": log.id,
        "count_in": log.count_in,
        "count_out": log.count_out,
        "timestamp": log.timestamp.isoformat() + "Z",
        "report": serialize_report(report, include_timeline=False),
    }), 201


@app.route("/api/reports/recent", methods=["GET"])
@jwt_required()
def recent_reports():
    uid = int(get_jwt_identity())
    limit = min(max(int(request.args.get("limit", 6)), 1), 30)
    reports = SessionReport.query.filter_by(user_id=uid).order_by(
        SessionReport.created_at.desc(),
        SessionReport.id.desc(),
    ).limit(limit).all()
    return jsonify({"reports": [serialize_report(report, include_timeline=False) for report in reports]})


@app.route("/api/reports/<int:report_id>", methods=["GET"])
@jwt_required()
def get_report(report_id):
    uid = int(get_jwt_identity())
    report = SessionReport.query.filter_by(id=report_id, user_id=uid).first()
    if not report:
        return jsonify({"error": "Report not found"}), 404
    return jsonify(serialize_report(report, include_timeline=True))


@app.route("/api/demo/readiness", methods=["GET"])
@jwt_required()
def demo_readiness():
    uid = int(get_jwt_identity())
    sessions = get_user_live_sessions(uid)
    live_summaries = [
        serialize_live_session(node_id, session, include_snapshot=False)
        for node_id, session in sessions.items()
    ]
    active_live = [session for session in live_summaries if session.get("active")]
    saved_records = CountLog.query.filter_by(user_id=uid).count()
    reports = SessionReport.query.filter_by(user_id=uid).count()
    latest_record = CountLog.query.filter_by(user_id=uid).order_by(
        CountLog.timestamp.desc(),
        CountLog.id.desc(),
    ).first()

    model_checks = {
        "count_model": {
            "label": COUNT_MODEL_PATH,
            "ready": os.path.exists(os.path.join(app.root_path, COUNT_MODEL_PATH)),
        },
        "id_model": {
            "label": ID_MODEL_PATH,
            "ready": os.path.exists(os.path.join(app.root_path, ID_MODEL_PATH)),
        },
    }
    ai_ready = bool(os.environ.get("OPENAI_API_KEY") or os.environ.get("GROQ_API_KEY"))

    checks = [
        {
            "id": "backend",
            "label": "Main backend",
            "status": "ready",
            "detail": "Flask API is authenticated and responding.",
        },
        {
            "id": "models",
            "label": "Model files",
            "status": "ready" if all(item["ready"] for item in model_checks.values()) else "warn",
            "detail": f"Count: {COUNT_MODEL_PATH}; ID: {ID_MODEL_PATH}",
        },
        {
            "id": "live_node",
            "label": "Phone live node",
            "status": "ready" if active_live else ("warn" if live_summaries else "missing"),
            "detail": f"{len(active_live)} active / {len(live_summaries)} known node(s).",
        },
        {
            "id": "saved_record",
            "label": "Saved count record",
            "status": "ready" if saved_records else "missing",
            "detail": f"{saved_records} saved record(s).",
        },
        {
            "id": "report",
            "label": "Farmer report",
            "status": "ready" if reports else "missing",
            "detail": f"{reports} generated report(s).",
        },
        {
            "id": "assistant",
            "label": "AI assistant",
            "status": "ready" if ai_ready else "warn",
            "detail": "API key configured." if ai_ready else "Assistant panel works, but backend AI key is not configured.",
        },
    ]

    ready_count = sum(1 for check in checks if check["status"] == "ready")
    readiness_percent = round((ready_count / len(checks)) * 100)
    blockers = [check["label"] for check in checks if check["status"] == "missing"]

    return jsonify({
        "readiness_percent": readiness_percent,
        "ready_count": ready_count,
        "total_checks": len(checks),
        "status": "ready" if readiness_percent == 100 else ("demo_ready_with_notes" if readiness_percent >= 70 else "needs_setup"),
        "checks": checks,
        "blockers": blockers,
        "models": model_checks,
        "latest_record": serialize_count_log(latest_record) if latest_record else None,
        "live_sessions": live_summaries,
    })


def build_agent_project_context(uid):
    user = User.query.get(uid)
    today_date = datetime.utcnow().date()
    today_logs = CountLog.query.filter(
        CountLog.user_id == uid,
        db.func.date(CountLog.timestamp) == today_date,
    ).all()
    recent_logs = CountLog.query.filter_by(user_id=uid).order_by(
        CountLog.timestamp.desc(),
        CountLog.id.desc(),
    ).limit(5).all()
    reports = SessionReport.query.filter_by(user_id=uid).order_by(
        SessionReport.created_at.desc(),
        SessionReport.id.desc(),
    ).limit(3).all()
    live_sessions = [
        compact_live_session_for_agent(node_id, session)
        for node_id, session in get_user_live_sessions(uid).items()
    ]

    return {
        "user": {
            "username": user.username if user else "Unknown",
            "default_hive": user.hive_name if user else "My Hive",
        },
        "today": {
            "date": str(today_date),
            "count_in": sum(log.count_in for log in today_logs),
            "count_out": sum(log.count_out for log in today_logs),
            "net": sum(log.count_in - log.count_out for log in today_logs),
            "saved_records": len(today_logs),
        },
        "live_sessions": live_sessions,
        "recent_records": [serialize_count_log(log) for log in recent_logs],
        "recent_reports": [compact_report_for_agent(report) for report in reports],
    }


def extract_openai_text(response):
    output_text = getattr(response, "output_text", None)
    if output_text:
        return output_text

    chunks = []
    for item in getattr(response, "output", []) or []:
        for content in getattr(item, "content", []) or []:
            text = getattr(content, "text", None)
            if text:
                chunks.append(text)
    return "\n".join(chunks).strip()


def parse_model_list(raw_models, fallback_models):
    if not raw_models:
        return fallback_models
    models = []
    for model_id in raw_models.split(","):
        model_id = model_id.strip()
        if model_id:
            models.append((model_id, model_id, "Configured backend model."))
    return models or fallback_models


def compact_live_session_for_agent(node_id, session):
    history = session.get("history", []) if session else []
    recent_points = history[-3:]
    return {
        "node_id": node_id,
        "hive_label": session.get("hive_label", "Hive 1"),
        "active": (int(time.time() * 1000) - session.get("updated_at_ms", 0)) < 10000,
        "updated_at": session.get("updated_at"),
        "status": session.get("status", "live"),
        "count_in": int(session.get("in", 0) or 0),
        "count_out": int(session.get("out", 0) or 0),
        "net": int(session.get("net", 0) or 0),
        "mode": session.get("mode", "motion"),
        "history_points": len(history),
        "recent_points": [
            {
                "time": point.get("time"),
                "in": int(point.get("in", 0) or 0),
                "out": int(point.get("out", 0) or 0),
                "net": int(point.get("net", 0) or 0),
            }
            for point in recent_points
        ],
        "saved": session.get("last_saved_signature") == _live_session_signature(session),
    }


def compact_report_for_agent(report):
    data = serialize_report(report, include_timeline=False)
    metrics = data.get("metrics", {}) or {}
    return {
        "id": data.get("id"),
        "title": data.get("title"),
        "summary": data.get("summary"),
        "status_label": data.get("status_label"),
        "recommendation": data.get("recommendation"),
        "created_at": data.get("created_at"),
        "metrics": {
            "count_in": metrics.get("count_in"),
            "count_out": metrics.get("count_out"),
            "net": metrics.get("net"),
            "total_crossings": metrics.get("total_crossings"),
            "duration_label": metrics.get("duration_label"),
        },
    }


def get_agent_models(provider=None):
    provider = (provider or os.environ.get("AI_PROVIDER", AI_PROVIDER)).strip().lower()
    if provider == "groq":
        models = parse_model_list(os.environ.get("GROQ_ALLOWED_MODELS"), DEFAULT_GROQ_MODELS)
        models = [
            model
            for model in models
            if model[0] in GROQ_AGENT_SAFE_MODEL_IDS and model[0] not in GROQ_AGENT_LOW_TPM_MODELS
        ] or DEFAULT_GROQ_MODELS
        configured_default = os.environ.get("GROQ_MODEL", DEFAULT_GROQ_MODEL)
        default_model = configured_default if configured_default in {model_id for model_id, _, _ in models} else GROQ_AGENT_SAFE_DEFAULT_MODEL
    else:
        default_model = os.environ.get("OPENAI_MODEL", DEFAULT_OPENAI_MODEL)
        models = parse_model_list(os.environ.get("OPENAI_ALLOWED_MODELS"), [
            (default_model, default_model, "Configured OpenAI model."),
        ])

    if default_model not in [model_id for model_id, _, _ in models]:
        models = [(default_model, default_model, "Backend default model.")] + models

    return {
        "provider": provider,
        "default_model": default_model,
        "models": [
            {"id": model_id, "label": label, "description": description}
            for model_id, label, description in models
        ],
    }


def resolve_agent_model(provider, requested_model):
    models = get_agent_models(provider)
    allowed_ids = {model["id"] for model in models["models"]}
    if provider == "groq" and requested_model in GROQ_AGENT_LOW_TPM_MODELS:
        return models["default_model"], None
    if not requested_model:
        return models["default_model"], None
    if requested_model not in allowed_ids:
        return None, (jsonify({
            "error": "Selected AI model is not allowed.",
            "allowed_models": sorted(allowed_ids),
        }), 400)
    return requested_model, None


def get_ai_provider_config(requested_model=None):
    provider = os.environ.get("AI_PROVIDER", AI_PROVIDER).strip().lower()
    model, model_error = resolve_agent_model(provider, requested_model)
    if model_error:
        return None, model_error
    if provider == "groq":
        return {
            "provider": "groq",
            "api_key": os.environ.get("GROQ_API_KEY"),
            "model": model,
            "base_url": os.environ.get("GROQ_BASE_URL", GROQ_BASE_URL),
            "key_name": "GROQ_API_KEY",
            "hint": "Set GROQ_API_KEY in the backend environment, then restart the dev runner.",
        }, None
    return {
        "provider": "openai",
        "api_key": os.environ.get("OPENAI_API_KEY"),
        "model": model,
        "base_url": None,
        "key_name": "OPENAI_API_KEY",
        "hint": "Set OPENAI_API_KEY in the backend environment, then restart the dev runner.",
    }, None


@app.route("/api/agent/models", methods=["GET"])
@jwt_required()
def agent_models():
    return jsonify(get_agent_models())


@app.route("/api/agent/chat", methods=["POST"])
@jwt_required()
def agent_chat():
    uid = int(get_jwt_identity())
    payload = request.get_json(silent=True) or {}
    message = (payload.get("message") or "").strip()
    if not message:
        return jsonify({"error": "Message is required"}), 400

    ai_config, config_error = get_ai_provider_config((payload.get("model") or "").strip())
    if config_error:
        return config_error
    if not ai_config["api_key"]:
        return jsonify({
            "error": f"{ai_config['key_name']} is not configured on the backend.",
            "setup_hint": ai_config["hint"],
        }), 503

    try:
        from openai import OpenAI
    except ImportError:
        return jsonify({
            "error": "OpenAI Python SDK is not installed.",
            "setup_hint": "Install backend requirements so the 'openai' package is available.",
        }), 503

    project_context = build_agent_project_context(uid)
    instructions = (
        "You are HiveGate AI's project-data assistant for a bee hive traffic monitoring web app. "
        "Answer only from the provided project data. Do not invent sensor readings, diagnoses, "
        "weather, disease claims, or hive conditions. If the data is insufficient, say what is missing. "
        "Use practical farmer-friendly language and include exact counts or report names when available."
    )
    agent_input = (
        "Project data JSON:\n"
        f"{json.dumps(project_context, ensure_ascii=True, default=str)}\n\n"
        f"Farmer question: {message}"
    )

    try:
      client_kwargs = {"api_key": ai_config["api_key"]}
      if ai_config["base_url"]:
          client_kwargs["base_url"] = ai_config["base_url"]
      client = OpenAI(**client_kwargs)
      response = client.responses.create(
          model=ai_config["model"],
          instructions=instructions,
          input=agent_input,
          store=False,
      )
      answer = extract_openai_text(response)
    except Exception as exc:
        app.logger.exception("%s agent request failed", ai_config["provider"])
        return jsonify({"error": f"AI agent request failed: {exc}"}), 502

    return jsonify({
        "answer": answer or "I could not generate an answer from the available project data.",
        "provider": ai_config["provider"],
        "model": ai_config["model"],
        "context": {
            "reports": len(project_context["recent_reports"]),
            "records": len(project_context["recent_records"]),
            "live_sessions": len(project_context["live_sessions"]),
        },
    })

# ── FEATURE 1: BEE IDENTIFICATION ────────────────────────
BEE_SPECIES = {
    0: {
        "name":        "Heterotrigona itama",
        "short":       "H. itama",
        "description": "Small stingless bee, common in Southeast Asia. Known for mild honey production.",
        "color":       "#f5a623"
    },
    1: {
        "name":        "Geniotrigona thoracica",
        "short":       "G. thoracica",
        "description": "Medium stingless bee with distinctive thorax markings. Found in lowland forests.",
        "color":       "#4aad7a"
    },
    2: {
        "name":        "Tetrigona binghami",
        "short":       "T. binghami",
        "description": "Dark-coloured stingless bee. Builds unique resin nests in tree cavities.",
        "color":       "#8b6bd8"
    }
}

@app.route("/api/identify", methods=["POST"])
@jwt_required()
def identify():
    if "image" not in request.files:
        return jsonify({"error": "No image uploaded"}), 400

    file  = request.files["image"]
    if not file.filename:
        return jsonify({"error": "Empty file"}), 400

    # Read image
    img_bytes = file.read()
    img_arr   = np.frombuffer(img_bytes, np.uint8)
    img       = cv2.imdecode(img_arr, cv2.IMREAD_COLOR)

    if img is None:
        return jsonify({"error": "Could not read image"}), 400

    # Run identification model
    model   = get_id_model()
    results = model(img, conf=0.25, verbose=False, device=YOLO_DEVICE)

    if not results[0].boxes or len(results[0].boxes) == 0:
        # No detection — try classifying whole image
        results = model(img, conf=0.1, verbose=False, device=YOLO_DEVICE)

    detections = []

    if results[0].boxes and len(results[0].boxes) > 0:
        boxes = results[0].boxes
        for i, box in enumerate(boxes.xyxy.cpu().numpy()):
            cls_id = int(boxes.cls[i].item())
            conf   = float(boxes.conf[i].item())
            x1,y1,x2,y2 = map(int, box)

            species = BEE_SPECIES.get(cls_id, {
                "name": f"Unknown (class {cls_id})",
                "short": "Unknown",
                "description": "Species not recognised.",
                "color": "#888"
            })

            detections.append({
                "species":     species["name"],
                "short":       species["short"],
                "description": species["description"],
                "color":       species["color"],
                "confidence":  round(conf * 100, 1),
                "bbox":        [x1, y1, x2, y2]
            })

        # Draw boxes on image
        for det in detections:
            x1,y1,x2,y2 = det["bbox"]
            color_hex = det["color"].lstrip("#")
            r,g,b = tuple(int(color_hex[i:i+2],16) for i in (0,2,4))
            cv2.rectangle(img, (x1,y1),(x2,y2), (b,g,r), 2)
            label = f"{det['short']} {det['confidence']}%"
            cv2.putText(img, label, (x1, y1-8),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (b,g,r), 2)

    # Encode annotated image as base64
    _, buf   = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 85])
    img_b64  = base64.b64encode(buf).decode("utf-8")

    # Sort by confidence
    detections.sort(key=lambda x: x["confidence"], reverse=True)

    return jsonify({
        "detections":     detections,
        "total_found":    len(detections),
        "annotated_image": img_b64
    })

# ── FEATURE 2: VIDEO BEE COUNTING ────────────────────────
@app.route("/api/get-first-frame", methods=["POST"])
@jwt_required()
def get_first_frame():
    """Returns the first frame of uploaded video as base64 so user can draw the line."""
    if "video" not in request.files:
        return jsonify({"error": "No video uploaded"}), 400

    file = request.files["video"]
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        file.save(tmp.name)
        tmp_path = tmp.name

    try:
        cap = cv2.VideoCapture(tmp_path)
        ret, frame = cap.read()
        cap.release()
        os.unlink(tmp_path)

        if not ret:
            return jsonify({"error": "Could not read video"}), 400

        frame = cv2.resize(frame, (960, 540))
        _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        img_b64 = base64.b64encode(buf).decode("utf-8")

        return jsonify({
            "frame":  img_b64,
            "width":  960,
            "height": 540
        })
    except Exception as e:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        return jsonify({"error": str(e)}), 500

@app.route("/api/count-video", methods=["POST"])
@jwt_required()
def count_video():
    """
    Receives video + line_x + hive_side.
    Runs counting model, returns IN/OUT counts + annotated video.
    """
    if "video" not in request.files:
        return jsonify({"error": "No video uploaded"}), 400

    file      = request.files["video"]
    line_x1   = int(request.form.get("line_x1", request.form.get("line_x", 300)))
    line_y1   = int(request.form.get("line_y1", request.form.get("line_y", 0)))
    line_x2   = int(request.form.get("line_x2", request.form.get("line_x", 300)))
    line_y2   = int(request.form.get("line_y2", request.form.get("line_y", 540)))
    hive_x    = int(request.form.get("hive_x", 0))
    hive_y    = int(request.form.get("hive_y", 0))
    roi_x     = int(request.form.get("roi_x", 0))
    roi_y     = int(request.form.get("roi_y", 0))
    roi_w     = int(request.form.get("roi_w", 960))
    roi_h     = int(request.form.get("roi_h", 540))
    debug_mode = request.form.get("debug", "false").lower() == "true"

    # Save uploaded video to temp file
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp_in:
        file.save(tmp_in.name)
        input_path = tmp_in.name

    output_path = input_path.replace(".mp4", "_counted.mp4")

    try:
        model = get_count_model()

        cap    = cv2.VideoCapture(input_path)
        fps    = int(cap.get(cv2.CAP_PROP_FPS)) or 30
        width  = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        # Resize to fixed size for consistency
        W, H = 960, 540
        fourcc    = cv2.VideoWriter_fourcc(*"mp4v")
        out_video = cv2.VideoWriter(output_path, fourcc, fps, (W, H))

        # The frontend uses a 960x540 preview, and we resize to the same
        # resolution before tracking, so keep the drawn geometry unchanged.
        line_start = (
            max(0, min(W - 1, int(line_x1))),
            max(0, min(H - 1, int(line_y1))),
        )
        line_end = (
            max(0, min(W - 1, int(line_x2))),
            max(0, min(H - 1, int(line_y2))),
        )
        hive_point = (
            max(0, min(W - 1, int(hive_x))),
            max(0, min(H - 1, int(hive_y))),
        )
        roi_left = max(0, min(W - 1, roi_x))
        roi_top = max(0, min(H - 1, roi_y))
        roi_right = max(roi_left + 1, min(W, roi_x + roi_w))
        roi_bottom = max(roi_top + 1, min(H, roi_y + roi_h))

        prev_side    = {}
        last_seen    = {}
        last_counted = {}
        stable_tracks = {}
        detector_to_stable = {}
        next_stable_id = 1
        total_in  = 0
        total_out = 0
        frame_count = 0
        track_cross_state = {}
        STALE      = 150
        COOLDOWN   = 30
        FLASH_DUR  = 20
        REASSIGN_WINDOW = 12
        MAX_MATCH_DISTANCE = 90
        MAX_SIZE_CHANGE = 0.8
        CROSSING_MARGIN = 24
        flash_events = []
        id_missing_frames = 0
        counted_events = []
        detection_frames = 0
        no_detection_frames = 0
        untracked_detection_frames = 0
        max_detections_in_frame = 0
        recent_untracked_frames = []

        line_dx = line_end[0] - line_start[0]
        line_dy = line_end[1] - line_start[1]
        line_length = np.hypot(line_dx, line_dy)
        if line_length < 10:
            return jsonify({"error": "Counting line is too short"}), 400

        def signed_distance(px, py):
            # Positive/negative side of the infinite line through the segment.
            numerator = ((px - line_start[0]) * line_dy) - ((py - line_start[1]) * line_dx)
            return numerator / line_length

        hive_side_sign = signed_distance(hive_point[0], hive_point[1])
        if abs(hive_side_sign) <= CROSSING_MARGIN:
            return jsonify({"error": "Hive-side point is too close to the counting line"}), 400

        def get_zone(value):
            if value < -CROSSING_MARGIN:
                return "left"
            if value > CROSSING_MARGIN:
                return "right"
            return "center"

        def center_and_size(box):
            x1, y1, x2, y2 = box
            cx = int((x1 + x2) / 2)
            cy = int((y1 + y2) / 2)
            w = max(1, x2 - x1)
            h = max(1, y2 - y1)
            return cx, cy, w, h

        def assign_stable_id(detector_id, box):
            nonlocal next_stable_id

            if detector_id in detector_to_stable:
                stable_id = detector_to_stable[detector_id]
                track = stable_tracks.get(stable_id)
                if track is not None:
                    return stable_id

            cx, cy, w, h = center_and_size(box)
            best_id = None
            best_score = None

            for stable_id, track in stable_tracks.items():
                frames_missing = frame_count - track["last_seen"]
                if frames_missing <= 0 or frames_missing > REASSIGN_WINDOW:
                    continue

                px, py = track["center"]
                pw, ph = track["size"]
                distance = np.hypot(cx - px, cy - py)
                if distance > MAX_MATCH_DISTANCE:
                    continue

                size_delta = max(abs(w - pw) / pw, abs(h - ph) / ph)
                if size_delta > MAX_SIZE_CHANGE:
                    continue

                score = distance + (frames_missing * 5)
                if best_score is None or score < best_score:
                    best_score = score
                    best_id = stable_id

            if best_id is None:
                best_id = next_stable_id
                next_stable_id += 1

            detector_to_stable[detector_id] = best_id
            return best_id

        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break

            frame = cv2.resize(frame, (W, H))
            frame_count += 1

            # Prune stale IDs
            stale = [t for t, f in list(last_seen.items()) if frame_count - f > STALE]
            for t in stale:
                prev_side.pop(t, None)
                last_seen.pop(t, None)
                last_counted.pop(t, None)
                stable_tracks.pop(t, None)
                track_cross_state.pop(t, None)

            lost_detector_ids = [
                detector_id
                for detector_id, stable_id in list(detector_to_stable.items())
                if stable_id not in last_seen
            ]
            for detector_id in lost_detector_ids:
                detector_to_stable.pop(detector_id, None)

            flash_events = [e for e in flash_events if e["end"] > frame_count]

            results = model.track(
                frame, persist=True, tracker="botsort.yaml",
                conf=0.12, iou=0.10, verbose=False, imgsz=960,
                device=YOLO_DEVICE
            )

            boxes_obj = results[0].boxes
            detection_count = len(boxes_obj) if boxes_obj is not None else 0
            tracked_count = 0
            max_detections_in_frame = max(max_detections_in_frame, detection_count)

            if detection_count > 0:
                detection_frames += 1
            else:
                no_detection_frames += 1

            if boxes_obj.id is not None:
                boxes = boxes_obj.xyxy.cpu().numpy()
                ids   = boxes_obj.id.cpu().numpy().astype(int)
                tracked_count = len(ids)

                for box, detector_tid in zip(boxes, ids):
                    x1,y1,x2,y2 = map(int, box)
                    cx, cy, bw, bh = center_and_size((x1, y1, x2, y2))

                    if not (roi_left <= cx <= roi_right and roi_top <= cy <= roi_bottom):
                        if debug_mode:
                            cv2.rectangle(frame, (x1, y1), (x2, y2), (90, 90, 90), 1)
                        continue

                    # Ignore bees too far from line
                    if abs(signed_distance(cx, cy)) > 250:
                        cv2.rectangle(frame,(x1,y1),(x2,y2),(60,60,60),1)
                        continue

                    tid = assign_stable_id(detector_tid, (x1, y1, x2, y2))
                    current_zone = get_zone(signed_distance(cx, cy))
                    last_seen[tid] = frame_count
                    stable_tracks[tid] = {
                        "center": (cx, cy),
                        "size": (bw, bh),
                        "last_seen": frame_count
                    }

                    state = track_cross_state.setdefault(tid, {
                        "last_zone": current_zone,
                        "approach_zone": None
                    })
                    prev_zone = state["last_zone"]

                    if current_zone == "center":
                        if prev_zone in ("left", "right"):
                            state["approach_zone"] = prev_zone
                    else:
                        approach_zone = state.get("approach_zone")
                        if approach_zone and current_zone != approach_zone:
                            lc = last_counted.get(tid, -COOLDOWN)
                            if frame_count - lc > COOLDOWN:
                                current_sign = -1 if current_zone == "left" else 1
                                going_in = (current_sign * hive_side_sign) > 0
                                if going_in:
                                    total_in += 1
                                    label = "IN"
                                else:
                                    total_out += 1
                                    label = "OUT"
                                last_counted[tid] = frame_count
                                counted_events.append({
                                    "frame": frame_count,
                                    "stable_id": tid,
                                    "detector_id": int(detector_tid),
                                    "from": approach_zone,
                                    "to": current_zone,
                                    "label": label
                                })
                                app.logger.info(
                                    "Counted %s at frame=%s stable_id=%s detector_id=%s from=%s to=%s",
                                    label, frame_count, tid, int(detector_tid), approach_zone, current_zone
                                )
                                flash_events.append({
                                    "end": frame_count+FLASH_DUR,
                                    "label": label, "cx": cx, "cy": cy
                                })
                            state["approach_zone"] = None
                        elif approach_zone == current_zone:
                            state["approach_zone"] = None

                    state["last_zone"] = current_zone
                    prev_side[tid] = current_zone
                    cv2.rectangle(frame,(x1,y1),(x2,y2),(0,220,255),2)
                    overlay = f"D{int(detector_tid)} S{tid} {current_zone[0].upper()}"
                    cv2.putText(frame, overlay, (x1, max(18, y1-5)),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0,220,255), 1)
            elif detection_count > 0:
                untracked_detection_frames += 1
                id_missing_frames += 1
                recent_untracked_frames.append(frame_count)
                recent_untracked_frames = recent_untracked_frames[-20:]
                if debug_mode:
                    boxes = boxes_obj.xyxy.cpu().numpy()
                    for box in boxes:
                        x1, y1, x2, y2 = map(int, box)
                        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 140, 255), 1)
                    cv2.putText(frame, "Tracker IDs missing on this frame", (20, 125),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 180, 255), 2)
            else:
                tracked_count = 0

            # Draw line with flash
            lc = (180,180,180)
            lt = 2
            if flash_events:
                fl = flash_events[-1]
                i  = int(255*(fl["end"]-frame_count)/FLASH_DUR)
                lc = (0,i,0) if fl["label"]=="IN" else (0,0,i)
                lt = 4

            # Frames are already resized to the same display width.
            if debug_mode:
                ov = frame.copy()
                cv2.rectangle(ov, (roi_left, roi_top), (roi_right, roi_bottom), (255, 176, 32), -1)
                cv2.addWeighted(ov, 0.12, frame, 0.88, 0, frame)
            cv2.line(frame, line_start, line_end, lc, lt)
            if debug_mode:
                cv2.rectangle(frame, (roi_left, roi_top), (roi_right, roi_bottom), (255, 176, 32), 2)
                cv2.circle(frame, hive_point, 6, (82, 196, 138), -1)
                cv2.putText(frame, "Hive side", (hive_point[0] + 8, max(18, hive_point[1] - 8)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.45, (82, 196, 138), 1)

            # Floating labels
            for e in flash_events:
                elapsed = FLASH_DUR-(e["end"]-frame_count)
                ly  = max(40, e["cy"]-int(elapsed*2))
                col = (0,255,80) if e["label"]=="IN" else (60,60,255)
                label_x = min(W - 150, max(12, line_start[0] + 8))
                cv2.putText(frame,f"+1 {e['label']}",(label_x,ly),
                            cv2.FONT_HERSHEY_SIMPLEX,0.8,(0,0,0),3)
                cv2.putText(frame,f"+1 {e['label']}",(label_x,ly),
                            cv2.FONT_HERSHEY_SIMPLEX,0.8,col,2)

            # Counter panel
            ov = frame.copy()
            cv2.rectangle(ov,(20,15),(220,95),(0,0,0),-1)
            cv2.addWeighted(ov,0.5,frame,0.5,0,frame)
            cv2.putText(frame,f"IN:  {total_in}", (30,48),
                        cv2.FONT_HERSHEY_SIMPLEX,1.0,(0,255,80),2)
            cv2.putText(frame,f"OUT: {total_out}",(30,85),
                        cv2.FONT_HERSHEY_SIMPLEX,1.0,(60,60,255),2)
            if debug_mode:
                cv2.putText(frame, f"ID-missing frames: {id_missing_frames}", (30, 120),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 220, 120), 2)
                cv2.putText(frame, f"Hive sign: {'positive' if hive_side_sign > 0 else 'negative'}", (30, 145),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (220, 220, 220), 2)
                cv2.putText(frame, f"Detections: {detection_count}  Tracked: {tracked_count}", (30, 170),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (120, 220, 255), 2)
                cv2.putText(frame, f"ROI: {roi_left},{roi_top} {roi_right-roi_left}x{roi_bottom-roi_top}", (30, 195),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 220, 120), 2)
                cv2.putText(frame, f"Line: ({line_start[0]},{line_start[1]}) to ({line_end[0]},{line_end[1]})", (30, 220),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (220, 220, 220), 2)

            out_video.write(frame)

        cap.release()
        out_video.release()
        os.unlink(input_path)

        # Read output video and return as base64
        with open(output_path, "rb") as f:
            video_b64 = base64.b64encode(f.read()).decode("utf-8")

        os.unlink(output_path)

        return jsonify({
            "total_in":    total_in,
            "total_out":   total_out,
            "total_frames": frame_count,
            "video_b64":   video_b64,
            "debug": {
                "enabled": debug_mode,
                "id_missing_frames": id_missing_frames,
                "detection_frames": detection_frames,
                "no_detection_frames": no_detection_frames,
                "untracked_detection_frames": untracked_detection_frames,
                "max_detections_in_frame": max_detections_in_frame,
                "recent_untracked_frames": recent_untracked_frames,
                "counted_events": counted_events[-20:]
            }
        })

    except Exception as e:
        app.logger.exception("Video counting failed")
        for p in [input_path, output_path]:
            if os.path.exists(p):
                os.unlink(p)
        return jsonify({"error": str(e)}), 500

# ── ADMIN ────────────────────────────────────────────────
@app.route("/api/admin/status", methods=["GET"])
@jwt_required()
def admin_status():
    import psutil
    _, admin_error = require_admin_user()
    if admin_error:
        return admin_error
    try:
        cpu_percent = psutil.cpu_percent(interval=0.5)
        memory = psutil.virtual_memory()
        disk = psutil.disk_usage(os.getcwd())

        db_path = app.config["SQLALCHEMY_DATABASE_URI"].replace("sqlite:///", "")
        
        # Resolve to instance/beecount.db if not absolute
        if not os.path.isabs(db_path):
             db_path = os.path.join(app.instance_path, db_path) if hasattr(app, 'instance_path') else db_path

        db_size = os.path.getsize(db_path) if os.path.exists(db_path) else 0

        total_users = User.query.count()
        total_logs = CountLog.query.count()
        total_reports = SessionReport.query.count()
        total_in = db.session.query(db.func.sum(CountLog.count_in)).scalar() or 0
        total_out = db.session.query(db.func.sum(CountLog.count_out)).scalar() or 0
        since_week = datetime.utcnow() - timedelta(days=7)
        active_user_ids = {
            row[0] for row in db.session.query(CountLog.user_id)
            .filter(CountLog.timestamp >= since_week)
            .distinct()
            .all()
        }

        recent_users = User.query.order_by(User.created_at.desc(), User.id.desc()).limit(12).all()
        recent_logs = CountLog.query.order_by(CountLog.timestamp.desc(), CountLog.id.desc()).limit(12).all()
        recent_reports = SessionReport.query.order_by(
            SessionReport.created_at.desc(),
            SessionReport.id.desc(),
        ).limit(8).all()

        activity_since = datetime.utcnow() - timedelta(days=13)
        activity_logs = CountLog.query.filter(CountLog.timestamp >= activity_since).order_by(CountLog.timestamp).all()
        activity = {}
        for log in activity_logs:
            key = log.timestamp.strftime("%Y-%m-%d")
            activity.setdefault(key, {"date": key, "in": 0, "out": 0, "records": 0})
            activity[key]["in"] += int(log.count_in or 0)
            activity[key]["out"] += int(log.count_out or 0)
            activity[key]["records"] += 1

        live_session_count = sum(len(sessions) for sessions in LIVE_SESSIONS.values())
        active_live_count = sum(
            1
            for sessions in LIVE_SESSIONS.values()
            for session in sessions.values()
            if session.get("active")
        )

        dataset_path = "yolo_dataset/images"
        try:
            dataset_count = len([
                name for name in os.listdir(dataset_path)
                if os.path.isfile(os.path.join(dataset_path, name))
            ]) if os.path.exists(dataset_path) else 0
        except OSError:
            dataset_count = 0

        return jsonify({
            "system": {
                "cpu_percent": cpu_percent,
                "memory_percent": memory.percent,
                "memory_used_mb": round(memory.used / (1024 * 1024), 2),
                "disk_percent": disk.percent
            },
            "database": {
                "size_mb": round(db_size / (1024 * 1024), 2),
                "total_users": total_users,
                "active_users_7d": len(active_user_ids),
                "total_logs": total_logs,
                "total_reports": total_reports,
                "total_in": total_in,
                "total_out": total_out
            },
            "models": {
                "count_model": COUNT_MODEL_PATH,
                "id_model": ID_MODEL_PATH,
                "dataset_images": dataset_count
            },
            "usage": {
                "videos_processed": total_logs,
                "live_sessions": live_session_count,
                "active_live_sessions": active_live_count,
                "reports_generated": total_reports,
                "recent_errors": read_recent_backend_errors(),
                "daily_activity": list(activity.values()),
            },
            "users": [serialize_admin_user(user) for user in recent_users],
            "recent_count_logs": [serialize_admin_count_log(log) for log in recent_logs],
            "recent_reports": [
                {
                    **serialize_report(report, include_timeline=False),
                    "user_id": report.user_id,
                    "username": (User.query.get(report.user_id).username if User.query.get(report.user_id) else "Deleted user"),
                }
                for report in recent_reports
            ],
            "status": "online"
        })
    except Exception as e:
        app.logger.exception("Admin status failed")
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
