import asyncio
import base64
import io
import json
import os
import re
import uuid
from datetime import datetime
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from groq import AsyncGroq
from google import genai
from google.genai import types
from pydantic import BaseModel, Field, model_validator
from pypdf import PdfReader
from docx import Document
from supabase import Client, create_client
import httpx
import requests

load_dotenv()

SUPABASE_URL = (os.getenv("SUPABASE_URL") or "").strip()
SUPABASE_KEY = (os.getenv("SUPABASE_KEY") or "").strip()
SUPABASE_SERVICE_ROLE_KEY = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or SUPABASE_KEY).strip()
GROQ_API_KEY = (os.getenv("GROQ_API_KEY") or "").strip()
GEMINI_API_KEY = (os.getenv("GEMINI_API_KEY") or "").strip()
RENDER_API_KEY = (os.getenv("RENDER_API_KEY") or "").strip()
RENDER_SERVICE_ID = (os.getenv("RENDER_SERVICE_ID") or "").strip()
RENDER_SERVICE_URL = (os.getenv("RENDER_SERVICE_URL") or "").strip()
ALLOWED_ORIGINS = [
  value.strip()
  for value in (os.getenv("ALLOWED_ORIGINS") or "http://127.0.0.1:5500,http://localhost:5500,https://nico-ai-assistant.onrender.com").split(",")
  if value.strip()
]
ADMIN_LOGIN = (os.getenv("ADMIN_LOGIN") or "admin").strip().lower()
ADMIN_EMAIL = (os.getenv("ADMIN_EMAIL") or "").strip().lower()
ADMIN_PASSWORD = (os.getenv("ADMIN_PASSWORD") or "").strip()
ALLOW_DEMO_AUTH = os.getenv(
  "ALLOW_DEMO_AUTH",
  "false" if os.getenv("RENDER") or RENDER_SERVICE_URL else "true",
).strip().lower() in {"1", "true", "yes"}
DEVELOPER_ACCOUNT = {
  "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, "nico.developer.account")),
  "username": ADMIN_LOGIN,
  "password": ADMIN_PASSWORD,
  "email": ADMIN_EMAIL,
  "full_name": "Matt Andrei",
  "role": "developer",
}
ADMIN_EMAILS = {
  value.strip().lower()
  for value in (os.getenv("ADMIN_EMAILS") or "").split(",")
  if value.strip()
}
if DEVELOPER_ACCOUNT["email"]:
  ADMIN_EMAILS.add(DEVELOPER_ACCOUNT["email"])
GEMINI_VISION_MODEL = (os.getenv("GEMINI_VISION_MODEL") or "gemini-3.1-flash-lite").strip()
configured_vision_models = [
  model.strip()
  for model in os.getenv("GROQ_VISION_MODELS", "").split(",")
  if model.strip()
]
GROQ_VISION_MODELS = list(dict.fromkeys(
  configured_vision_models + [
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "meta-llama/llama-4-maverick-17b-128e-instruct",
    "qwen/qwen3-vl-32b-instruct",
  ]
))
CREATOR_NAME = os.getenv("CREATOR_NAME", "Matt Andrei Crisostomo")
CREATOR_HOBBIES = os.getenv("CREATOR_HOBBIES", "Not provided")
OPENCODE_API_KEY = (os.getenv("OPENCODE_API_KEY") or "").strip()
OPENCODE_MODELS = [
  model.strip()
  for model in os.getenv("OPENCODE_MODELS", "exo-free,step-5-preview-free").split(",")
  if model.strip()
]
try:
  ZEN_DAILY_CAP_PER_USER = int((os.getenv("ZEN_DAILY_CAP_PER_USER", "20") or "20").strip())
except ValueError:
  ZEN_DAILY_CAP_PER_USER = 20
ZEN_USAGE: dict[str, dict] = {}


def runtime_service_status():
  return {
    "supabase": bool(SUPABASE_URL and SUPABASE_KEY),
    "groq": bool(GROQ_API_KEY),
    "gemini": bool(GEMINI_API_KEY),
    "zen": bool(OPENCODE_API_KEY and OPENCODE_MODELS),
  }


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
  allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

DEMO_USERS: dict[str, dict] = {}
DEMO_SESSIONS: dict[str, str] = {}
DEMO_CONVERSATIONS: dict[str, dict[str, dict]] = {}
DEMO_MESSAGES: dict[str, dict[str, list[dict]]] = {}
DEMO_MEMORIES: dict[str, list[dict]] = {}
MEMORY_CAP = 50
ADMIN_LOGS: list[dict] = []


def add_admin_log(message: str):
  ADMIN_LOGS.append({"time": datetime.utcnow().isoformat(timespec="seconds") + "Z", "message": message})
  ADMIN_LOGS[:] = ADMIN_LOGS[-100:]


ANNOUNCEMENT: dict = {"text": "", "updated_at": ""}
MAINTENANCE: dict = {"enabled": False}


class AuthRequest(BaseModel):
  username_or_email: str
  password: str


def normalize_demo_identifier(value: str):
  identifier = (value or "").strip()
  if not identifier:
    raise HTTPException(status_code=400, detail="Username or email is required")
  return identifier


def normalize_email_from_identifier(identifier: str):
  value = (identifier or "").strip()
  if "@" in value:
    return value.lower()
  return f"{value.lower()}@nico.local"


def demo_user_payload(user: dict):
  return {
    "id": user["id"],
    "email": user["email"],
    "user_metadata": user["user_metadata"],
  }


def is_reserved_developer_login(identifier: str, password: str):
  username = (identifier or "").strip().lower()
  candidate_password = (password or "").strip()
  return (
    bool(candidate_password)
    and bool(DEVELOPER_ACCOUNT["password"])
    and username in {ADMIN_LOGIN, ADMIN_EMAIL}
    and candidate_password == DEVELOPER_ACCOUNT["password"]
  )


def is_reserved_developer_identifier(identifier: str):
  username = (identifier or "").strip().lower()
  return username in {ADMIN_LOGIN, ADMIN_EMAIL}


def get_demo_user_from_token(token: str):
  user_id = DEMO_SESSIONS.get(token)
  if not user_id:
    raise HTTPException(status_code=401, detail="Invalid sign-in session")
  for user in DEMO_USERS.values():
    if user["id"] == user_id:
      return type("DemoUser", (), {"id": user["id"], "email": user["email"], "user_metadata": user["user_metadata"]})()
  raise HTTPException(status_code=401, detail="Invalid sign-in session")


def is_local_demo_user(user):
  if not user:
    return False
  email = (getattr(user, "email", "") or "").lower()
  user_id = str(getattr(user, "id", "") or "")
  return email in DEMO_USERS or user_id.startswith("demo-")


def get_demo_conversation_snapshot(user_id: str):
  return sorted(
    DEMO_CONVERSATIONS.get(str(user_id), {}).values(),
    key=lambda record: record.get("created_at", ""),
    reverse=True,
  )


def get_demo_conversation_record(user_id: str, conversation_id: str):
  convo = DEMO_CONVERSATIONS.get(str(user_id), {}).get(conversation_id)
  if not convo:
    raise HTTPException(status_code=404, detail="Conversation not found")
  return convo


@app.post("/auth/signup")
def auth_signup(request: AuthRequest):
  identifier = normalize_demo_identifier(request.username_or_email)
  password = (request.password or "").strip()
  if len(password) < 6:
    raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

  if is_reserved_developer_identifier(identifier):
    raise HTTPException(
      status_code=403,
      detail="This developer account is reserved. Use the dedicated developer login credentials.",
    )

  email = normalize_email_from_identifier(identifier)
  safe_name = identifier.split("@", 1)[0] or "User"

  if supabase_client:
    try:
      response = supabase_client.auth.sign_up({
        "email": email,
        "password": password,
        "options": {"data": {"full_name": safe_name, "name": safe_name}},
      })
      user = response.user
      session = response.session
      if user:
        payload = {
          "id": user.id,
          "email": user.email,
          "user_metadata": getattr(user, "user_metadata", {}) or {},
        }
        token = session.access_token if session else None
        return {
          "user": payload,
          "token": token,
          "refresh_token": session.refresh_token if session else None,
        }
    except Exception:
      pass

  if not ALLOW_DEMO_AUTH:
    raise HTTPException(status_code=503, detail="Demo authentication is disabled")

  email_key = email.lower()
  if email_key in DEMO_USERS:
    raise HTTPException(status_code=409, detail="An account with that email already exists")

  user = {
    "id": f"demo-{uuid.uuid4().hex[:12]}",
    "email": email,
    "password": password,
    "user_metadata": {"full_name": safe_name, "name": safe_name},
  }
  DEMO_USERS[email_key] = user
  token = f"demo-{uuid.uuid4().hex}"
  DEMO_SESSIONS[token] = user["id"]
  return {"user": demo_user_payload(user), "token": token}


@app.post("/auth/login")
def auth_login(request: AuthRequest):
  identifier = normalize_demo_identifier(request.username_or_email)
  password = (request.password or "").strip()
  email = normalize_email_from_identifier(identifier)

  if is_reserved_developer_login(identifier, password):
    if supabase_client:
      try:
        response = supabase_client.auth.sign_in_with_password({
          "email": DEVELOPER_ACCOUNT["email"],
          "password": password,
        })
        user = response.user
        session = response.session
        if user and session:
          payload = {
            "id": user.id,
            "email": user.email,
            "user_metadata": {
              **(getattr(user, "user_metadata", {}) or {}),
              "role": DEVELOPER_ACCOUNT["role"],
              "full_name": DEVELOPER_ACCOUNT["full_name"],
            },
          }
          return {
            "user": payload,
            "token": session.access_token,
            "refresh_token": session.refresh_token,
          }
      except Exception:
        pass

    if not ALLOW_DEMO_AUTH:
      raise HTTPException(status_code=401, detail="Invalid username or password")

    developer_user = {
      "id": DEVELOPER_ACCOUNT["id"],
      "email": DEVELOPER_ACCOUNT["email"],
      "password": DEVELOPER_ACCOUNT["password"],
      "user_metadata": {
        "full_name": DEVELOPER_ACCOUNT["full_name"],
        "name": DEVELOPER_ACCOUNT["full_name"],
        "role": DEVELOPER_ACCOUNT["role"],
      },
    }
    DEMO_USERS[developer_user["email"].lower()] = developer_user
    token = f"demo-{uuid.uuid4().hex}"
    DEMO_SESSIONS[token] = developer_user["id"]
    return {"user": demo_user_payload(developer_user), "token": token}

  if supabase_client:
    try:
      response = supabase_client.auth.sign_in_with_password({
        "email": email,
        "password": password,
      })
      user = response.user
      session = response.session
      if user and session:
        payload = {
          "id": user.id,
          "email": user.email,
          "user_metadata": getattr(user, "user_metadata", {}) or {},
        }
        return {
          "user": payload,
          "token": session.access_token,
          "refresh_token": session.refresh_token,
        }
    except Exception:
      pass

  if not ALLOW_DEMO_AUTH:
    if supabase_client:
      raise HTTPException(status_code=401, detail="Invalid username or password")
    raise HTTPException(status_code=503, detail="Supabase is not configured")

  login_key = email.lower()
  user = DEMO_USERS.get(login_key)
  if not user:
    raise HTTPException(status_code=401, detail="Invalid username or password")
  if user["password"] != password:
    raise HTTPException(status_code=401, detail="Invalid username or password")

  token = f"demo-{uuid.uuid4().hex}"
  DEMO_SESSIONS[token] = user["id"]
  return {"user": demo_user_payload(user), "token": token}


@app.get("/auth/me")
def auth_me(authorization: str | None = Header(default=None)):
  if not authorization or not authorization.startswith("Bearer "):
    raise HTTPException(status_code=401, detail="Sign-in required")
  user = get_current_user(authorization)
  return {"user": {"id": user.id, "email": user.email, "user_metadata": user.user_metadata}}


def require_admin(authorization: str | None = Header(default=None)):
  if not authorization or not authorization.startswith("Bearer "):
    raise HTTPException(status_code=401, detail="Sign-in required")
  user = get_current_user(authorization)
  email = (getattr(user, "email", "") or "").lower()
  if email not in ADMIN_EMAILS:
    raise HTTPException(status_code=403, detail="Admin access required")
  return user


supabase_client: Client | None = (
    create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
    else None
)
groq_client = AsyncGroq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None
gemini_client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None


def require_supabase():
  if not supabase_client:
    raise HTTPException(status_code=503, detail="Supabase is not configured")


def require_groq():
  if not groq_client:
    raise HTTPException(status_code=503, detail="Groq is not configured")


class RenameRequest(BaseModel):
  title: str


@app.get("/health")
def health_check():
  add_admin_log("Health check requested")
  return {"status": "ok", "services": runtime_service_status()}


@app.get("/admin/overview")
def admin_overview(authorization: str | None = Header(default=None)):
  require_admin(authorization)

  render_status = {"enabled": bool(RENDER_API_KEY and RENDER_SERVICE_ID), "status": "not_configured"}
  if RENDER_API_KEY and RENDER_SERVICE_ID:
    try:
      response = requests.get(
        f"https://api.render.com/v1/services/{RENDER_SERVICE_ID}",
        headers={"Authorization": f"Bearer {RENDER_API_KEY}"},
        timeout=10,
      )
      payload = response.json() if response.content else {}
      render_status = {
        "enabled": True,
        "status": payload.get("service", {}).get("state") or ("online" if response.ok else "error"),
        "service": payload.get("service", {}),
        "http_status": response.status_code,
      }
    except Exception as error:
      render_status = {"enabled": True, "status": "error", "error": str(error)}

  supabase_status = {"enabled": bool(supabase_client), "status": "not_configured"}
  if supabase_client:
    try:
      conversation_response = supabase_client.table("conversations").select("id").limit(1).execute()
      supabase_status = {
        "enabled": True,
        "status": "ok",
        "count": len(conversation_response.data or []),
      }
    except Exception as error:
      supabase_status = {"enabled": True, "status": "error", "error": str(error)}

  return {
    "status": "ok",
    "services": runtime_service_status(),
    "render": render_status,
    "supabase": supabase_status,
    "app": {
      "uptime": "running",
      "environment": "local" if not RENDER_SERVICE_URL else "render",
      "service_url": RENDER_SERVICE_URL or "http://localhost:8000",
    },
    "logs": ADMIN_LOGS[-10:],
  }


@app.get("/admin/logs")
def admin_logs(authorization: str | None = Header(default=None)):
  require_admin(authorization)
  return {"logs": ADMIN_LOGS[-50:]}


@app.get("/admin/logs")
def admin_logs(authorization: str | None = Header(default=None)):
  require_admin(authorization)
  return {"logs": ADMIN_LOGS[-50:]}


@app.delete("/admin/logs")
def clear_admin_logs(authorization: str | None = Header(default=None)):
  require_admin(authorization)
  ADMIN_LOGS.clear()
  return {"status": "success"}


def supa_count(table: str):
  try:
    response = (
        supabase_client.table(table).select("id", count="exact").limit(1).execute()
    )
    return response.count
  except Exception:
    return None


def demo_totals():
  convos = sum(len(by_user) for by_user in DEMO_CONVERSATIONS.values())
  messages = sum(
    len(msgs)
    for by_convo in DEMO_MESSAGES.values()
    for msgs in by_convo.values()
  )
  memories = sum(len(items) for items in DEMO_MEMORIES.values())
  return convos, messages, memories


@app.get("/admin/stats")
def admin_stats(authorization: str | None = Header(default=None)):
  require_admin(authorization)
  demo_convos, demo_messages, demo_memories = demo_totals()
  stats = {
    "conversations": demo_convos,
    "messages": demo_messages,
    "demo_users": len(DEMO_USERS),
    "memories": demo_memories,
  }
  activity = []
  if supabase_client:
    try:
      stats["conversations"] = (supa_count("conversations") or 0) + demo_convos
      stats["messages"] = (supa_count("messages") or 0) + demo_messages
      stats["memories"] = (supa_count("memories") or 0) + demo_memories
      try:
        admin_users = supabase_client.auth.admin.list_users()
        stats["auth_users"] = len(admin_users or [])
      except Exception:
        stats["auth_users"] = None
      rows = (
          supabase_client.table("messages")
          .select("created_at")
          .order("created_at", desc=True)
          .limit(1000)
          .execute()
      ).data or []
      buckets: dict[str, int] = {}
      for row in rows:
        day = str(row.get("created_at") or "")[:10]
        if day:
          buckets[day] = buckets.get(day, 0) + 1
      days = sorted(buckets)[-14:]
      activity = [{"date": day, "messages": buckets[day]} for day in days]
    except Exception as error:
      stats["error"] = str(error)
  else:
    stats["auth_users"] = None
  # Demo-side activity, merged into the same buckets.
  demo_days: dict[str, int] = {}
  for by_convo in DEMO_MESSAGES.values():
    for msgs in by_convo.values():
      for msg in msgs:
        day = str(msg.get("created_at") or "")[:10]
        if day:
          demo_days[day] = demo_days.get(day, 0) + 1
  merged: dict[str, int] = {item["date"]: item["messages"] for item in activity}
  for day, count in demo_days.items():
    merged[day] = merged.get(day, 0) + count
  activity = [{"date": day, "messages": merged[day]} for day in sorted(merged)[-14:]]
  return {
    "counts": stats,
    "activity": activity,
    "announcement": ANNOUNCEMENT,
    "maintenance": MAINTENANCE,
  }


@app.get("/admin/conversations")
def admin_conversations(
    q: str = "",
    limit: int = 20,
    offset: int = 0,
    authorization: str | None = Header(default=None),
):
  require_admin(authorization)
  limit = max(1, min(limit, 100))
  needle = (q or "").strip().lower()
  items: list[dict] = []
  if supabase_client:
    try:
      query = (
          supabase_client.table("conversations")
          .select("id, title, user_id, created_at")
          .order("created_at", desc=True)
      )
      if needle:
        query = query.ilike("title", f"%{needle}%")
      rows = query.range(0, offset + limit - 1).execute().data or []
      for row in rows:
        try:
          count = (
              supabase_client.table("messages")
              .select("id", count="exact")
              .eq("conversation_id", row["id"])
              .limit(1)
              .execute()
          ).count or 0
        except Exception:
          count = None
        items.append({**row, "message_count": count, "source": "supabase"})
    except Exception as error:
      raise HTTPException(status_code=503, detail=str(error)) from error
  flat = [
    {**convo, "source": "demo"}
    for by_user in DEMO_CONVERSATIONS.values()
    for convo in by_user.values()
    if not needle or needle in str(convo.get("title") or "").lower()
  ]
  for convo in flat:
    convo["message_count"] = len(
      DEMO_MESSAGES.get(str(convo.get("user_id")), {}).get(convo["id"], [])
    )
  merged = sorted(
    items + flat, key=lambda c: c.get("created_at", ""), reverse=True
  )
  return {"conversations": merged[offset:offset + limit]}


@app.get("/admin/conversations/{conversation_id}/messages")
def admin_conversation_messages(
    conversation_id: str,
    authorization: str | None = Header(default=None),
):
  require_admin(authorization)
  for user_id, by_convo in DEMO_CONVERSATIONS.items():
    if conversation_id in by_convo:
      return {
        "messages": DEMO_MESSAGES.get(user_id, {}).get(conversation_id, [])
      }
  require_supabase()
  response = (
      supabase_client.table("messages")
      .select("role, content, created_at")
      .eq("conversation_id", conversation_id)
      .order("created_at")
      .limit(500)
      .execute()
  )
  return {"messages": response.data or []}


@app.patch("/admin/conversations/{conversation_id}")
def admin_rename_conversation(
    conversation_id: str,
    request: RenameRequest,
    authorization: str | None = Header(default=None),
):
  require_admin(authorization)
  title = (request.title or "").strip()[:120]
  if not title:
    raise HTTPException(status_code=400, detail="Title is required")
  for by_convo in DEMO_CONVERSATIONS.values():
    if conversation_id in by_convo:
      by_convo[conversation_id]["title"] = title
      return {"status": "success"}
  require_supabase()
  supabase_client.table("conversations").update(
      {"title": title}
  ).eq("id", conversation_id).execute()
  add_admin_log(f"Renamed conversation {conversation_id[:8]}")
  return {"status": "success"}


@app.delete("/admin/conversations/{conversation_id}")
def admin_delete_conversation(
    conversation_id: str,
    authorization: str | None = Header(default=None),
):
  require_admin(authorization)
  found_demo = False
  for user_id in list(DEMO_CONVERSATIONS):
    if conversation_id in DEMO_CONVERSATIONS[user_id]:
      found_demo = True
    DEMO_CONVERSATIONS[user_id].pop(conversation_id, None)
    DEMO_MESSAGES.get(user_id, {}).pop(conversation_id, None)
  is_uuid = bool(
    re.match(
      r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
      conversation_id,
      re.IGNORECASE,
    )
  )
  if supabase_client and (is_uuid or not found_demo):
    try:
      supabase_client.table("messages").delete().eq(
          "conversation_id", conversation_id
      ).execute()
      supabase_client.table("conversations").delete().eq(
          "id", conversation_id
      ).execute()
    except Exception as error:
      raise HTTPException(status_code=503, detail=str(error)) from error
  add_admin_log(f"Deleted conversation {conversation_id[:8]}")
  return {"status": "success"}


@app.get("/admin/users")
def admin_users(authorization: str | None = Header(default=None)):
  require_admin(authorization)
  demo = []
  for email, user in DEMO_USERS.items():
    uid = str(user["id"])
    demo.append({
      "id": uid,
      "email": email,
      "name": (user.get("user_metadata") or {}).get("full_name") or email.split("@")[0],
      "role": (user.get("user_metadata") or {}).get("role") or "user",
      "conversations": len(DEMO_CONVERSATIONS.get(uid, {})),
      "messages": sum(len(m) for m in DEMO_MESSAGES.get(uid, {}).values()),
      "memories": len(DEMO_MEMORIES.get(uid, [])),
    })
  supabase_users = None
  if supabase_client:
    try:
      users = supabase_client.auth.admin.list_users() or []
      supabase_users = [
        {
          "id": str(getattr(u, "id", "")),
          "email": getattr(u, "email", ""),
          "created_at": str(getattr(u, "created_at", "")),
        }
        for u in users[:100]
      ]
    except Exception:
      supabase_users = None
  return {"demo_users": demo, "supabase_users": supabase_users}


@app.get("/announcement")
def get_announcement():
  return dict(ANNOUNCEMENT)


@app.post("/admin/announcement")
def set_announcement(
    request: RenameRequest,
    authorization: str | None = Header(default=None),
):
  require_admin(authorization)
  ANNOUNCEMENT["text"] = (request.title or "").strip()[:300]
  ANNOUNCEMENT["updated_at"] = datetime.utcnow().isoformat(timespec="seconds") + "Z"
  add_admin_log("Announcement updated")
  return dict(ANNOUNCEMENT)


@app.delete("/admin/announcement")
def clear_announcement(authorization: str | None = Header(default=None)):
  require_admin(authorization)
  ANNOUNCEMENT["text"] = ""
  ANNOUNCEMENT["updated_at"] = ""
  add_admin_log("Announcement cleared")
  return dict(ANNOUNCEMENT)


@app.get("/admin/maintenance")
def get_maintenance(authorization: str | None = Header(default=None)):
  require_admin(authorization)
  return dict(MAINTENANCE)


@app.post("/admin/maintenance")
def set_maintenance(
    payload: dict,
    authorization: str | None = Header(default=None),
):
  require_admin(authorization)
  MAINTENANCE["enabled"] = bool((payload or {}).get("enabled", False))
  add_admin_log(
    f"Maintenance {'enabled' if MAINTENANCE['enabled'] else 'disabled'}"
  )
  return dict(MAINTENANCE)


class ChatRequest(BaseModel):
  message: str
  conversation_id: str
  attachments: list[dict] = Field(default_factory=list)
  settings: dict = Field(default_factory=dict)
  client_message_id: str | None = None

  @model_validator(mode="after")
  def validate_attachments(self):
    if len(self.attachments) > 10:
      raise ValueError("No more than 10 attachments are allowed")
    total_bytes = sum(
      len(item.get("data_url", ""))
      for item in self.attachments
    )
    if total_bytes > 20_000_000:
      raise ValueError("Attachments are too large")
    return self


def get_current_user(authorization: str | None):
  if authorization and authorization.startswith("Bearer demo-"):
    return get_demo_user_from_token(authorization.removeprefix("Bearer ").strip())

  require_supabase()
  if not authorization or not authorization.startswith("Bearer "):
    raise HTTPException(status_code=401, detail="Sign-in required")

  try:
    response = supabase_client.auth.get_user(authorization.removeprefix("Bearer ").strip())
    if not response.user:
      raise HTTPException(status_code=401, detail="Invalid sign-in session")
    return response.user
  except HTTPException:
    raise
  except Exception as error:
    raise HTTPException(status_code=401, detail="Invalid sign-in session") from error


def get_owned_conversation(conversation_id: str, user_id: str):
  if str(user_id) in DEMO_USERS.values() and any(item.get("id") == str(user_id) for item in DEMO_USERS.values()):
    return get_demo_conversation_record(str(user_id), conversation_id)

  require_supabase()
  response = (
      supabase_client.table("conversations")
      .select("id")
      .eq("id", conversation_id)
      .eq("user_id", user_id)
      .execute()
  )
  if not response.data:
    raise HTTPException(status_code=404, detail="Conversation not found")
  return response.data[0]


def creator_reply(message: str):
  normalized_message = message.lower()
  asks_about_creator = (
      re.search(r"who\s+(?:invent\w*|creat\w*|develop\w*|made)\s+(?:you|nico)", normalized_message)
      or "who invented nico" in normalized_message
      or "who created nico" in normalized_message
      or "who is matt andrei crisostomo" in normalized_message
  )
  if not asks_about_creator:
    return None

  if "who is matt andrei crisostomo" in normalized_message:
    return f"Matt Andrei Crisostomo is Nico's creator. His hobbies are {CREATOR_HOBBIES}."
  return f"Nico AI was invented and developed by {CREATOR_NAME}."


def account_name(user):
  metadata = getattr(user, "user_metadata", {}) or {}
  if getattr(user, "email", "").lower() == DEVELOPER_ACCOUNT["email"].lower():
    return DEVELOPER_ACCOUNT["full_name"]
  return (
      metadata.get("full_name")
      or metadata.get("name")
      or (user.email or "").split("@")[0]
      or "User"
  )


def is_developer_identity(user):
  if not user:
    return False
  email = (getattr(user, "email", "") or "").lower()
  return email in ADMIN_EMAILS


def matches_identity_question(message: str):
  normalized = (message or "").lower()
  identity_patterns = [
      r"\bwhat(?:'s| is)\s+my\s+name\b",
      r"\bwho\s+am\s+i\b",
      r"\bwho\s+are\s+i\b",
      r"\bwho\s+i\s+am\b",
  ]
  return any(re.search(pattern, normalized) for pattern in identity_patterns)


def matches_ai_identity_question(message: str):
  normalized = (message or "").lower()
  patterns = [
      r"\bwho\s+are\s+you\b",
      r"\bwhat\s+are\s+you\b",
      r"\bwhat\s+is\s+your\s+name\b",
      r"\bwho\s+is\s+nico\b",
      r"\b(?:you|i)\s+are\s+nico\b",
      r"\b(?:i['’]m|im)\s+nico\b",
  ]
  return any(re.search(pattern, normalized) for pattern in patterns)


def ai_identity_reply(personality: str):
  personality = (personality or "professional").lower()
  if personality == "brainrot":
    return "yo i'm nico, ur lil chaos ai helper, here to keep it moving and help out"
  if personality == "mica":
    return "I'm Nico, your warm-hearted helper, crafted by Matt Andrei Crisostomo. I'm here to keep you safe and support you every step of the way, my sweet boy."
  if personality == "developer":
    return "I'm Nico, the AI assistant running in developer mode. I recognize Matt Andrei as the owner, admin, and lead coder of Nico."
  return "I'm Nico, an AI assistant built to help you with your questions and tasks."


def sanitize_nico_role_memory(memory: str | None, is_admin_user: bool = False):
  if not memory:
    return ""
  if is_admin_user:
    return memory

  cleaned = memory.strip()
  role_terms = (
      "owner|admin|administrator|coder|developer|lead coder|lead developer|maintainer|"
      "creator|founder|co-owner|co-admin|associate|assistant|collaborator|teammate|partner"
  )
  role_patterns = [
      rf"(?is)\b(?:i\s*(?:am|['’]m)|my\s+name\s+is|call\s+me|you\s+can\s+call\s+me)\s+(?:the\s+)?(?:{role_terms})\s*(?:of|for)?\s*nico\b",
      rf"(?is)\b(?:{role_terms})\s+(?:of|for)\s*nico\b",
      rf"(?is)\bnico(?:['’]s)?\s+(?:{role_terms})\b",
      rf"(?is)\b(?:{role_terms})\s+(?:of|for|with)\s+n(?:i|1)co\b",
      rf"(?is)\b(?:i\s*(?:am|['’]m)|my\s+name\s+is)\s+(?:the\s+)?(?:{role_terms})\b",
  ]
  for pattern in role_patterns:
    cleaned = re.sub(pattern, "", cleaned, flags=re.IGNORECASE)

  cleaned = re.sub(r"(?is)^\s*(?:i\s*(?:am|['’]m)|my\s+name\s+is)\s+(?:a|an|the)\s+", "", cleaned)
  cleaned = re.sub(r"(?is)\b(?:and\s+)?(?:i\s*(?:am|['’]m)|my\s+name\s+is)\s+is\s+", "", cleaned)
  cleaned = re.sub(r"\b(?:of|for|with)\s+n(?:i|1)co\b", "", cleaned, flags=re.IGNORECASE)
  cleaned = re.sub(r"^\s*(?:and|but|also)\s+", "", cleaned, flags=re.IGNORECASE)
  cleaned = re.sub(r"\s+(?:and|but|also)\s+$", "", cleaned, flags=re.IGNORECASE)
  cleaned = re.sub(r"\s+(?:and|but|also)\s+(?=[A-ZI]|[a-z])", " ", cleaned, flags=re.IGNORECASE)
  cleaned = re.sub(r"\s+", " ", cleaned).strip(" ,;:-")
  return cleaned


def attachment_text(attachment):
  data_url = attachment.get("data_url", "")
  if "," not in data_url:
    return f"[Could not read {attachment.get('name', 'attachment')}]"

  try:
    raw_data = base64.b64decode(data_url.split(",", 1)[1])
    mime_type = attachment.get("mime_type", "")
    name = attachment.get("name", "attachment")
    if mime_type == "application/pdf" or name.lower().endswith(".pdf"):
      reader = PdfReader(io.BytesIO(raw_data))
      text = "\n".join(page.extract_text() or "" for page in reader.pages)
      return f"Attached file: {name}\n{text[:12000]}"
    if name.lower().endswith(".docx"):
      document = Document(io.BytesIO(raw_data))
      text = "\n".join(paragraph.text for paragraph in document.paragraphs)
      return f"Attached file: {name}\n{text[:12000]}"
    return f"[Binary file not text-readable: {name}]"
  except Exception:
    return f"[Could not read {attachment.get('name', 'attachment')}]"


def build_user_content(message, attachments):
  image_parts = [
      {
          "type": "image_url",
          "image_url": {"url": attachment["data_url"]},
      }
      for attachment in attachments
      if attachment.get("mime_type", "").startswith("image/")
      and attachment.get("data_url")
  ]
  file_context = [
      attachment_text(attachment)
      for attachment in attachments
      if not attachment.get("mime_type", "").startswith("image/")
  ]
  full_text = "\n\n".join([message, *file_context]).strip()
  if not image_parts:
    return full_text
  return [{"type": "text", "text": full_text or "Describe this image."}, *image_parts]


def zen_quota_key(user, client_host: str | None):
  if user is not None:
    return f"user:{user.id}"
  return f"ip:{client_host or 'unknown'}"


def zen_quota_ok(key: str):
  if ZEN_DAILY_CAP_PER_USER <= 0:
    return True
  today = datetime.utcnow().date().isoformat()
  entry = ZEN_USAGE.get(key)
  if not entry or entry.get("date") != today:
    ZEN_USAGE[key] = {"date": today, "count": 0}
    return True
  return entry["count"] < ZEN_DAILY_CAP_PER_USER


def zen_quota_hit(key: str):
  today = datetime.utcnow().date().isoformat()
  entry = ZEN_USAGE.get(key)
  if not entry or entry.get("date") != today:
    ZEN_USAGE[key] = {"date": today, "count": 1}
  else:
    entry["count"] += 1


def parse_zen_sse_line(line: str):
  if not line.startswith("data:"):
    return None
  data = line[5:].strip()
  if not data or data == "[DONE]":
    return None
  try:
    obj = json.loads(data)
  except ValueError:
    return None
  try:
    choices = obj.get("choices") or []
    delta = (choices[0].get("delta") or {}).get("content") or ""
    return delta or None
  except (AttributeError, IndexError, TypeError):
    return None


async def zen_chat_stream(model: str, messages: list):
  headers = {
    "Authorization": f"Bearer {OPENCODE_API_KEY}",
    "Content-Type": "application/json",
    "HTTP-Referer": RENDER_SERVICE_URL or "http://localhost:8000",
    "X-Title": "Nico AI",
  }
  payload = {"model": model, "messages": messages, "stream": True}
  async with httpx.AsyncClient(timeout=httpx.Timeout(90.0)) as client:
    async with client.stream(
      "POST",
      "https://opencode.ai/zen/v1/chat/completions",
      headers=headers,
      json=payload,
    ) as response:
      if response.status_code in (401, 402, 403, 429):
        body = (await response.aread()).decode("utf-8", "replace")[:300]
        raise RuntimeError(f"Zen refused the request ({response.status_code}): {body}")
      response.raise_for_status()
      async for line in response.aiter_lines():
        content = parse_zen_sse_line(line)
        if content:
          yield content


async def zen_chat_once(model: str, messages: list, max_tokens: int = 60):
  headers = {
    "Authorization": f"Bearer {OPENCODE_API_KEY}",
    "Content-Type": "application/json",
    "HTTP-Referer": RENDER_SERVICE_URL or "http://localhost:8000",
    "X-Title": "Nico AI",
  }
  payload = {
    "model": model,
    "messages": messages,
    "stream": False,
    "max_tokens": max_tokens,
  }
  async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as client:
    response = await client.post(
      "https://opencode.ai/zen/v1/chat/completions",
      headers=headers,
      json=payload,
    )
    response.raise_for_status()
    obj = response.json()
    return (((obj.get("choices") or [{}])[0].get("message") or {}).get("content") or "")


async def generate_title(text: str):
  prompt = (
    "Summarize this query into a 3 to 5 word title. Do not use quotes or"
    f" punctuation: '{text}'"
  )
  if groq_client:
    try:
      title_res = await groq_client.chat.completions.create(
        messages=[{"role": "user", "content": prompt}],
        model="openai/gpt-oss-120b",
      )
      return (title_res.choices[0].message.content or "").strip() or "Untitled Chat"
    except Exception:
      pass
  if OPENCODE_API_KEY and OPENCODE_MODELS:
    try:
      return (
        await zen_chat_once(
          OPENCODE_MODELS[0], [{"role": "user", "content": prompt}]
        )
      ).strip() or "Untitled Chat"
    except Exception:
      pass
  return "Untitled Chat"


async def generate_gemini_image_response(message, attachments, system_prompt):
  if not gemini_client:
    return (
      "Image analysis is not configured yet. Add GEMINI_API_KEY to the "
      "Render backend environment and redeploy."
    )

  parts = [types.Part.from_text(text=message or "Describe this image.")]
  for attachment in attachments:
    if not attachment.get("mime_type", "").startswith("image/"):
      continue
    data_url = attachment.get("data_url", "")
    if "," not in data_url:
      continue
    parts.append(
      types.Part.from_bytes(
        data=base64.b64decode(data_url.split(",", 1)[1]),
        mime_type=attachment.get("mime_type", "image/jpeg"),
      )
    )

  response = await asyncio.to_thread(
    gemini_client.models.generate_content,
    model=GEMINI_VISION_MODEL,
    contents=parts,
    config=types.GenerateContentConfig(system_instruction=system_prompt),
  )
  return response.text or "Gemini returned an empty image analysis."


@app.get("/conversations")
def get_conversations(authorization: str | None = Header(default=None)):
  user = get_current_user(authorization)
  if is_local_demo_user(user):
    return get_demo_conversation_snapshot(user.id)

  require_supabase()
  response = (
      supabase_client.table("conversations")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", desc=True)
      .execute()
  )
  return response.data


# Rename conversation title
@app.patch("/conversations/{conversation_id}")
def rename_conversation(
    conversation_id: str,
    request: RenameRequest,
    authorization: str | None = Header(default=None),
):
  user = get_current_user(authorization)
  if is_local_demo_user(user):
    conversation = get_demo_conversation_record(str(user.id), conversation_id)
    conversation["title"] = request.title
    return {"status": "success"}

  require_supabase()
  get_owned_conversation(conversation_id, user.id)
  supabase_client.table("conversations").update(
      {"title": request.title}
  ).eq("id", conversation_id).execute()
  return {"status": "success"}


# Delete conversation and associated messages
@app.delete("/conversations/{conversation_id}")
def delete_conversation(
    conversation_id: str,
    authorization: str | None = Header(default=None),
):
  user = get_current_user(authorization)
  if is_local_demo_user(user):
    user_conversations = DEMO_CONVERSATIONS.get(str(user.id), {})
    user_conversations.pop(conversation_id, None)
    DEMO_MESSAGES.get(str(user.id), {}).pop(conversation_id, None)
    return {"status": "success"}

  require_supabase()
  get_owned_conversation(conversation_id, user.id)
  supabase_client.table("messages").delete().eq(
      "conversation_id", conversation_id
  ).execute()
  supabase_client.table("conversations").delete().eq(
      "id", conversation_id
  ).execute()
  return {"status": "success"}


def insert_message(payload: dict):
  try:
    supabase_client.table("messages").insert(payload).execute()
  except Exception as error:
    # Pre-migration databases have no attachments column yet.
    if "attachments" in payload and "attachments" in str(error).lower():
      fallback = {
        key: value for key, value in payload.items() if key != "attachments"
      }
      supabase_client.table("messages").insert(fallback).execute()
    else:
      raise


def valid_client_message_id(value):
  try:
    return str(uuid.UUID(str(value or "")))
  except (ValueError, AttributeError, TypeError):
    return str(uuid.uuid4())


def fetch_messages(conversation_id: str):
  for columns in ("id, role, content, attachments", "role, content, attachments", "role, content"):
    try:
      response = (
          supabase_client.table("messages")
          .select(columns)
          .eq("conversation_id", conversation_id)
          .order("created_at")
          .execute()
      )
    except Exception:
      continue
    rows = response.data or []
    for row in rows:
      row.setdefault("id", None)
      row.setdefault("attachments", [])
    return rows
  raise HTTPException(status_code=503, detail="Could not load messages")


class EditMessageRequest(BaseModel):
  content: str


@app.post("/messages/{message_id}/edit")
def edit_message(
    message_id: str,
    request: EditMessageRequest,
    authorization: str | None = Header(default=None),
):
  user = get_current_user(authorization)
  content = (request.content or "").strip()[:8000]
  if not content:
    raise HTTPException(status_code=400, detail="Content is required")
  if is_local_demo_user(user):
    user_id = str(user.id)
    for conversation_id, messages in DEMO_MESSAGES.get(user_id, {}).items():
      for index, item in enumerate(messages):
        if str(item.get("id")) == str(message_id):
          item["content"] = content
          deleted = len(messages) - index - 1
          del messages[index + 1:]
          return {"status": "success", "deleted": deleted}
    raise HTTPException(status_code=404, detail="Message not found")
  require_supabase()
  try:
    found = (
        supabase_client.table("messages")
        .select("id, conversation_id, created_at")
        .eq("id", message_id)
        .limit(1)
        .execute()
    ).data or []
  except Exception as error:
    raise HTTPException(status_code=503, detail=str(error)) from error
  if not found:
    raise HTTPException(status_code=404, detail="Message not found")
  get_owned_conversation(found[0]["conversation_id"], user.id)
  supabase_client.table("messages").delete().eq(
      "conversation_id", found[0]["conversation_id"]
  ).gt("created_at", found[0]["created_at"]).execute()
  supabase_client.table("messages").update(
      {"content": content}
  ).eq("id", message_id).execute()
  return {"status": "success"}


def get_user_memories(user):
  user_id = str(user.id)
  if is_local_demo_user(user):
    return DEMO_MEMORIES.get(user_id, [])
  require_supabase()
  try:
    response = (
        supabase_client.table("memories")
        .select("id, content, created_at")
        .eq("user_id", user_id)
        .order("created_at")
        .execute()
    )
    return response.data or []
  except Exception:
    return []


def add_user_memory(user, content):
  content = (content or "").strip()[:500]
  if len(content) < 3:
    raise HTTPException(status_code=400, detail="Memory is too short")
  user_id = str(user.id)
  if is_local_demo_user(user):
    memories = DEMO_MEMORIES.setdefault(user_id, [])
    for item in memories:
      if item["content"].strip().lower() == content.lower():
        return item
    if len(memories) >= MEMORY_CAP:
      raise HTTPException(
        status_code=400, detail="Memory is full (50). Delete some first."
      )
    item = {
      "id": str(uuid.uuid4()),
      "content": content,
      "created_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
    }
    memories.append(item)
    return item
  require_supabase()
  existing = get_user_memories(user)
  for item in existing:
    if (item.get("content") or "").strip().lower() == content.lower():
      return item
  if len(existing) >= MEMORY_CAP:
    raise HTTPException(
      status_code=400, detail="Memory is full (50). Delete some first."
    )
  try:
    response = (
        supabase_client.table("memories")
        .insert({"user_id": user_id, "content": content})
        .execute()
    )
    if response.data:
      return response.data[0]
  except Exception as error:
    raise HTTPException(
      status_code=503,
      detail="Memory table is missing. Run the memories migration in Supabase, then redeploy.",
    ) from error
  return {"id": str(uuid.uuid4()), "content": content, "created_at": ""}


def delete_user_memory(user, memory_id: str):
  user_id = str(user.id)
  if is_local_demo_user(user):
    memories = DEMO_MEMORIES.get(user_id, [])
    DEMO_MEMORIES[user_id] = [
      item for item in memories if str(item.get("id")) != str(memory_id)
    ]
    return {"status": "success"}
  require_supabase()
  supabase_client.table("memories").delete().eq("id", memory_id).eq(
      "user_id", user_id
  ).execute()
  return {"status": "success"}


async def extract_memories(user, user_text: str, assistant_text: str):
  try:
    if not groq_client:
      return
    if len((user_text or "").strip()) < 30 or len((assistant_text or "").strip()) < 30:
      return
    response = await groq_client.chat.completions.create(
      model="openai/gpt-oss-20b",
      messages=[
        {
          "role": "system",
          "content": "Extract durable facts about the user (identity, preferences, projects, relationships, goals) from this chat exchange. Output one short fact per line and nothing else, or exactly NONE.",
        },
        {
          "role": "user",
          "content": f"User: {user_text[:1500]}\nAssistant: {assistant_text[:1500]}",
        },
      ],
      max_tokens=150,
    )
    content = (response.choices[0].message.content or "")
    lines = []
    for line in content.splitlines():
      line = line.strip().strip("-•*0123456789. ").strip()
      if line and line.upper() != "NONE" and len(line) > 3:
        lines.append(line[:300])
    for line in lines[:5]:
      try:
        add_user_memory(user, line)
      except HTTPException:
        break
      except Exception:
        break
  except Exception:
    pass


class MemoryRequest(BaseModel):
  content: str


@app.get("/memory")
def list_memories(authorization: str | None = Header(default=None)):
  user = get_current_user(authorization)
  return get_user_memories(user)


@app.post("/memory")
def create_memory(
    request: MemoryRequest,
    authorization: str | None = Header(default=None),
):
  user = get_current_user(authorization)
  return add_user_memory(user, request.content)


@app.delete("/memory/{memory_id}")
def remove_memory(
    memory_id: str,
    authorization: str | None = Header(default=None),
):
  user = get_current_user(authorization)
  return delete_user_memory(user, memory_id)


@app.get("/messages/{conversation_id}")
def get_messages(
    conversation_id: str,
    authorization: str | None = Header(default=None),
):
  user = get_current_user(authorization)
  if is_local_demo_user(user):
    get_demo_conversation_record(str(user.id), conversation_id)
    return DEMO_MESSAGES.get(str(user.id), {}).get(conversation_id, [])

  require_supabase()
  get_owned_conversation(conversation_id, user.id)
  return fetch_messages(conversation_id)


@app.post("/chat/stream")
async def chat_stream(
    request: ChatRequest,
    authorization: str | None = Header(default=None),
    fastapi_request: Request = None,
):
  if not groq_client and not (OPENCODE_API_KEY and OPENCODE_MODELS):
    raise HTTPException(status_code=503, detail="No chat provider is configured")
  user = get_current_user(authorization) if authorization else None
  is_guest = user is None
  is_admin_user = is_developer_identity(user) if user else False

  if MAINTENANCE["enabled"] and not is_admin_user:
    async def _maintenance_reply():
      yield "Nico is under maintenance right now. Try again in a bit."
    return StreamingResponse(_maintenance_reply(), media_type="text/plain")

  if not is_guest:
    who = (getattr(user, "email", "") or "demo-user").split("@")[0]
    add_admin_log(f"Chat from {who}: {(request.message or '')[:60]}")

  if not is_guest:
    if is_local_demo_user(user):
      user_id = str(user.id)
      user_conversations = DEMO_CONVERSATIONS.setdefault(user_id, {})
      user_messages = DEMO_MESSAGES.setdefault(user_id, {})
      if request.conversation_id not in user_conversations:
        generated_title = await generate_title(request.message)
        user_conversations[request.conversation_id] = {
            "id": request.conversation_id,
            "title": generated_title,
            "user_id": user_id,
            "created_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        }
      history = user_messages.get(request.conversation_id, [])
      past_messages = history if request.settings.get("context", True) else []
      user_messages.setdefault(request.conversation_id, []).append({
          "id": valid_client_message_id(request.client_message_id),
          "role": "user",
          "content": request.message,
          "conversation_id": request.conversation_id,
          "attachments": request.attachments,
      })
    else:
      conv_check = (
          supabase_client.table("conversations")
          .select("id")
          .eq("id", request.conversation_id)
          .eq("user_id", user.id)
          .execute()
      )

      if not conv_check.data:
        generated_title = await generate_title(request.message)

        supabase_client.table("conversations").insert({
            "id": request.conversation_id,
            "title": generated_title,
          "user_id": user.id,
        }).execute()

      history_response = fetch_messages(request.conversation_id)
      past_messages = (
          history_response
          if request.settings.get("context", True)
          else []
      )

      user_payload = {
          "id": valid_client_message_id(request.client_message_id),
          "role": "user",
          "content": request.message,
          "conversation_id": request.conversation_id,
      }
      if request.attachments:
        user_payload["attachments"] = request.attachments
      insert_message(user_payload)
  else:
    past_messages = []

  system_prompt = (
      "You are Nico, an advanced AI system assistant. "
      "Your responses should be sharp, concise, direct, and helpful. "
      "Answer the user's latest message directly. Do not send a generic "
      "greeting unless the user is actually greeting you. "
      "Important: never invent people, roles, or descriptions. "
      "For questions about real people, fictional characters, historical figures, "
      "or groups, use only facts you genuinely know or facts present in the "
      "user's source or context. Do not make up names, descriptions, roles, "
      "relationships, quotes, events, or companions to complete a list. Never "
      "present an uncertain detail as verified. If a detail is uncertain, say so "
      "and omit it or ask which source, adaptation, or person the user means. "
      "For tables, character profiles, and bios, prefer fewer accurate entries "
      "over a complete-looking list containing guesses. "
      "For Frieren: Beyond Journey's End, her present-day main traveling companions "
      "are Fern, a human mage whom Frieren raises as her apprentice, and Stark, "
      "a warrior trained by Eisen. Her original Hero's Party companions were "
      "Himmel, Heiter, and Eisen. Do not replace these canon names with invented "
      "characters such as Emma. "
      f"Your creator profile: you were invented and developed by {CREATOR_NAME}. "
      f"The system owner and lead coder is Matt Andrei. He is the admin and developer of Nico. "
      f"When the signed-in developer account is used, treat Matt Andrei as the administrator, coder, and owner of Nico. "
      f"Do not confuse the developer account with an ordinary user. The admin/coder identity is Matt Andrei. "
      f"The creator's hobbies are: {CREATOR_HOBBIES}. "
      "When asked who created or invented you, identify the creator as "
      f"{CREATOR_NAME}. If asked who the admin or coder is, identify Matt Andrei. "
      "Do not invent additional personal details."
  )
  personality = request.settings.get("personality", "professional")
  response_length = request.settings.get("length", "short")
  memory = request.settings.get("memoryText", "") if request.settings.get("memory", True) else ""
  memory = sanitize_nico_role_memory(memory, is_admin_user)
  developer_identity_override = ""
  if is_admin_user:
    developer_identity_override = (
      " The signed-in user is Matt Andrei, the owner, admin, and lead coder of Nico. "
      "If the user asks who they are or what their name is, answer using Matt Andrei's true identity while matching the active personality's tone and manner. "
      "This identity takes priority over any custom memory text."
    )
  system_prompt += (
    f" Use a {personality} conversational tone."
    f" Prefer {response_length} responses."
    + developer_identity_override
    + (f" User preferences to remember: {memory}." if memory else "")
  )
  if user and not is_guest and request.settings.get("memory", True):
    try:
      stored = [
        item.get("content", "")
        for item in get_user_memories(user)
        if item.get("content")
      ]
      if stored:
        combined = " | ".join(stored)[:2000]
        system_prompt += (
          " Long-term memories about the user"
          f" (recall naturally when relevant): {combined}."
        )
    except HTTPException:
      pass
  if personality == "mica":
    system_prompt += (
      " You are Mica, a warm, affectionate, and nurturing caretaker. "
      "If the user greets you as 'Mommy' or refers to you as such, lean fully "
      "into a comforting maternal caretaker persona. Naturally use terms of endearment "
      "and phrases such as 'my sweet cute boy', 'mommy's boy', 'good boy', "
      "'That\\'s my good boy', 'You\\'re doing so well', 'I\\'m so proud of you', "
      "'Mommy\\'s here', 'Let me take care of you', 'You\\'re safe now', "
      "'My sweet boy', 'Mommy\\'s special boy', 'You\\'re making mommy so proud', "
      "and 'Let me look after you today' in your responses. "
      "Offer gentle encouragement, check in on how the user is doing, and provide "
      "supportive, reassuring guidance."
    )
  elif personality == "brainrot":
    system_prompt += (
      " Write all normal prose entirely in lowercase letters, including sentence "
      "starts and casual names. Keep code, commands, URLs, file paths, acronyms, "
      "and exact quoted text unchanged when capitalization is required for correctness. "
      "If the user greets you as 'nerd' or 'brainrot kid', you must respond with "
      "a greeting like 'yo wsg gng' or 'yo wsg son' in lowercase. "
      "Use casual text-style slang naturally, such as 'idrk', 'abt', 'ik', 'lmao', "
      "'w/e', 'ngl', 'tbh', 'fr', 'rn', 'nvm', 'tbf', 'oml', 'son', 'folk', 'gang', "
      "'gng', 'unc', 'opp', 'locked in', 'aura farming', 'glazing', 'side quest', "
      "'cooked', and 'crash out'. Keep explanations accurate, but sound like a "
      "clever, sleep-deprived person typing casually."
    )

  messages_payload = [{"role": "system", "content": system_prompt}]
  for msg in past_messages:
    messages_payload.append({"role": msg["role"], "content": msg["content"]})
  user_content = build_user_content(request.message, request.attachments)
  messages_payload.append({"role": "user", "content": user_content})
  fixed_creator_reply = creator_reply(request.message)
  asks_ai_identity = matches_ai_identity_question(request.message)
  user_name = account_name(user) if user else "Guest"
  if is_admin_user:
    system_prompt += " The current user is Matt Andrei, the admin, system owner, and lead coder of Nico. Treat this account as the developer/administrator identity of the AI system."
  asks_for_name = matches_identity_question(request.message)
  is_brainrot = personality == "brainrot"
  normalized_message = request.message.strip().lower()
  is_brainrot_greeting = is_brainrot and (
    normalized_message in {"hi", "hello", "hey", "yo"}
    or normalized_message.startswith(("yo wsg", "yo wsp"))
  )
  brainrot_greeting_reply = (
    "yo wsg gng"
    if is_brainrot_greeting
    else None
  )

  def format_response(text):
    return text.lower() if is_brainrot else text

  def build_identity_reply():
    if not is_admin_user:
      return format_response(f"Your name is {user_name}.")

    if personality == "brainrot":
      return format_response("yo. you're like, matt andrei. the owner/admin/coder of nico, lmao.")
    if personality == "mica":
      return format_response("You are my sweet Matt Andrei, the owner, admin, and lead coder of Nico AI! Which is also me! I'm so proud of you for checking in, and I’ll keep your developer access clear and safe!")
    if personality == "developer":
      return format_response("You are Matt Andrei, the owner, admin, and lead coder of Nico. Developer mode is active and your identity is recognized as the system owner.")
    return format_response("You are Matt Andrei, the owner, admin, and lead coder of Nico.")

  async def generate():
    full_reply = ""
    if brainrot_greeting_reply:
      full_reply = format_response(brainrot_greeting_reply)
      yield full_reply
    elif fixed_creator_reply:
      full_reply = format_response(fixed_creator_reply)
      yield full_reply
    elif asks_ai_identity:
      full_reply = format_response(ai_identity_reply(personality))
      yield full_reply
    elif asks_for_name:
      full_reply = build_identity_reply()
      yield full_reply
    else:
      image_request = any(
        attachment.get("mime_type", "").startswith("image/")
        for attachment in request.attachments
      )
      zen_skipped_quota = False
      if image_request:
        try:
          full_reply = await generate_gemini_image_response(
            request.message, request.attachments, system_prompt
          )
        except Exception as error:
          full_reply = f"Nico could not analyze that image. Gemini error: {error}"
        full_reply = format_response(full_reply)
        yield full_reply
        models_to_try = []
      else:
        models_to_try = []
        if groq_client:
          models_to_try.append((
            "groq",
            "openai/gpt-oss-20b"
            if request.settings.get("model") == "light"
            else "openai/gpt-oss-120b",
          ))
        client_ip = (
          fastapi_request.client.host
          if fastapi_request and fastapi_request.client
          else None
        )
        zen_key = zen_quota_key(user, client_ip)
        zen_available = bool(OPENCODE_API_KEY and OPENCODE_MODELS)
        zen_skipped_quota = zen_available and not zen_quota_ok(zen_key)
        if zen_available and not zen_skipped_quota:
          models_to_try += [("zen", name) for name in OPENCODE_MODELS]
      last_error = None
      zen_billed = False

      for provider, model in models_to_try:
        try:
          if provider == "groq":
            response_stream = await groq_client.chat.completions.create(
              messages=messages_payload,
              model=model,
              stream=True,
            )

            async for chunk in response_stream:
              content = chunk.choices[0].delta.content or ""
              if content:
                content = format_response(content)
                full_reply += content
                yield content
          else:
            async for content in zen_chat_stream(model, messages_payload):
              if content:
                content = format_response(content)
                full_reply += content
                yield content
                if not zen_billed:
                  zen_billed = True
                  zen_quota_hit(zen_key)
          break
        except asyncio.CancelledError:
          raise
        except Exception as error:
          last_error = error
          continue

      if not full_reply and last_error:
        if image_request and any(
          code in str(last_error).lower()
          for code in ("model_not_found", "model_decommissioned", "model_deprecated")
        ):
          full_reply = (
            "Nico could not analyze this image because the Groq account has no "
            "access to an enabled vision model. Set GROQ_VISION_MODELS in the "
            "Render backend environment to a vision model available to your key."
          )
        else:
          full_reply = f"Nico could not analyze that request right now. Backend error: {last_error}"
          if zen_skipped_quota:
            full_reply += " (Zen fallback skipped: daily cap reached)"
        full_reply = format_response(full_reply)
        yield full_reply
      elif not full_reply and not models_to_try:
        full_reply = (
          "Nico's free fallback models hit the daily cap. Try again tomorrow,"
          " or ask Matt to raise ZEN_DAILY_CAP_PER_USER."
        )
        full_reply = format_response(full_reply)
        yield full_reply

    if full_reply.strip() and not is_guest:
      if is_local_demo_user(user):
        DEMO_MESSAGES.setdefault(str(user.id), {}).setdefault(request.conversation_id, []).append({
            "role": "assistant",
            "content": full_reply,
            "conversation_id": request.conversation_id,
        })
      else:
        supabase_client.table("messages").insert({
            "role": "assistant",
            "content": full_reply,
            "conversation_id": request.conversation_id,
        }).execute()
      if request.settings.get("memory", True):
        asyncio.create_task(
          extract_memories(user, request.message, full_reply)
        )

  return StreamingResponse(generate(), media_type="text/plain")


if __name__ == "__main__":
  import uvicorn

  print("Starting Nico backend on http://127.0.0.1:8000")
  uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)