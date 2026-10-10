import asyncio
import base64
import io
import json
import os
import re
import uuid
from datetime import datetime
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Response
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
HF_TOKEN = (os.getenv("HF_TOKEN") or os.getenv("HF_KEY") or "").strip()
HF_IMAGE_MODEL = (os.getenv("HF_IMAGE_MODEL") or "black-forest-labs/FLUX.1-schnell").strip()
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
  for model in os.getenv("OPENCODE_MODELS", "nemotron-3-ultra-free,exo-free").split(",")
  if model.strip()
]


def runtime_service_status():
  return {
    "supabase": bool(SUPABASE_URL and SUPABASE_KEY),
    "groq": bool(GROQ_API_KEY),
    "gemini": bool(GEMINI_API_KEY),
    "zen": bool(OPENCODE_API_KEY and OPENCODE_MODELS),
    "hf": bool(HF_TOKEN),
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
DEMO_BADGES: dict[str, list[dict]] = {}
GRANTABLE_BADGES = {"tester", "major_supporter", "supporter"}
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
  return {
    "user": {"id": user.id, "email": user.email, "user_metadata": user.user_metadata},
    "badges": sorted(get_user_badges(user)),
  }


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


async def generate_title(text: str, use_zen: bool = False):
  prompt = (
    "Summarize this query into a 3 to 5 word title. Do not use quotes or"
    f" punctuation: '{text}'"
  )

  async def via_zen():
    return (
      await zen_chat_once(
        OPENCODE_MODELS[0], [{"role": "user", "content": prompt}]
      )
    ).strip() or "Untitled Chat"

  async def via_groq():
    title_res = await groq_client.chat.completions.create(
      messages=[{"role": "user", "content": prompt}],
      model="openai/gpt-oss-120b",
    )
    return (title_res.choices[0].message.content or "").strip() or "Untitled Chat"

  attempts = []
  if use_zen and OPENCODE_API_KEY and OPENCODE_MODELS:
    attempts.append(via_zen)
  if groq_client:
    attempts.append(via_groq)
  for attempt in attempts:
    try:
      return await attempt()
    except Exception:
      continue
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
    # Pre-migration databases may lack the attachments / client_id columns.
    message = str(error).lower()
    if any(key in payload and key in message for key in ("attachments", "client_id")):
      fallback = {
        key: value
        for key, value in payload.items()
        if key not in ("attachments", "client_id")
      }
      supabase_client.table("messages").insert(fallback).execute()
    else:
      raise


def fetch_messages(conversation_id: str):
  for columns in (
    "id, role, content, attachments, client_id",
    "id, role, content, attachments",
    "role, content, attachments",
    "role, content",
  ):
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
      row.setdefault("client_id", None)
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
        if str(item.get("id")) == str(message_id) or (
          item.get("client_id") and str(item.get("client_id")) == str(message_id)
        ):
          item["content"] = content
          deleted = len(messages) - index - 1
          del messages[index + 1:]
          return {"status": "success", "deleted": deleted}
    raise HTTPException(status_code=404, detail="Message not found")
  require_supabase()
  found = []
  try:
    found = (
        supabase_client.table("messages")
        .select("id, conversation_id, created_at")
        .eq("client_id", message_id)
        .limit(1)
        .execute()
    ).data or []
  except Exception:
    found = []
  if not found and str(message_id).isdigit():
    try:
      found = (
          supabase_client.table("messages")
          .select("id, conversation_id, created_at")
          .eq("id", int(message_id))
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
  ).eq("id", found[0]["id"]).execute()
  return {"status": "success"}


def md_to_blocks(markdown_text):
  """Minimal markdown -> neutral blocks.

  Returns a list of (kind, payload) where kind is one of
  h1/h2/h3/p/quote/code/ul/ol/hr. Payload is str, or list[str] for
  lists, or "" for hr.
  """
  blocks = []
  lines = (markdown_text or "").replace("\r\n", "\n").split("\n")
  i = 0
  in_code = False
  code_buf: list[str] = []
  list_buf = None

  def flush_list():
    nonlocal list_buf
    if list_buf:
      blocks.append(list_buf)
      list_buf = None

  structural = re.compile(r"^(#{1,3}\s|[-*]\s|\d+[.)]\s|>\s?|---+$)")
  while i < len(lines):
    line = lines[i]
    if line.strip().startswith("```"):
      if in_code:
        blocks.append(("code", "\n".join(code_buf)))
        code_buf = []
        in_code = False
      else:
        flush_list()
        in_code = True
      i += 1
      continue
    if in_code:
      code_buf.append(line)
      i += 1
      continue
    stripped = line.strip()
    if not stripped:
      flush_list()
      i += 1
      continue
    heading = re.match(r"^(#{1,3})\s+(.*)$", stripped)
    if heading:
      flush_list()
      blocks.append((f"h{len(heading.group(1))}", heading.group(2).strip()))
      i += 1
      continue
    bullet = re.match(r"^[-*]\s+(.*)$", stripped)
    if bullet:
      if not list_buf or list_buf[0] != "ul":
        flush_list()
        list_buf = ("ul", [])
      list_buf[1].append(bullet.group(1).strip())
      i += 1
      continue
    numbered = re.match(r"^(\d{1,3})[.)]?\s+(.*)$", stripped)
    if numbered:
      if not list_buf or list_buf[0] != "ol":
        flush_list()
        list_buf = ("ol", [])
      list_buf[1].append(numbered.group(2).strip())
      i += 1
      continue
    quote = re.match(r"^>\s?(.*)$", stripped)
    if quote:
      flush_list()
      blocks.append(("quote", quote.group(1)))
      i += 1
      continue
    if re.match(r"^---+$", stripped):
      flush_list()
      blocks.append(("hr", ""))
      i += 1
      continue
    flush_list()
    para = [stripped]
    i += 1
    while i < len(lines):
      nxt = lines[i].strip()
      if not nxt or nxt.startswith("```") or structural.match(nxt):
        break
      para.append(nxt)
      i += 1
    blocks.append(("p", " ".join(para)))
  if in_code:
    blocks.append(("code", "\n".join(code_buf)))
  flush_list()
  return blocks


def split_inline(text):
  """Split into (style, chunk); style is '', 'b', 'i' or 'code'."""
  parts = []
  pattern = re.compile(r"(\*\*.+?\*\*|\*[^*]+?\*|`[^`]+?`)")
  pos = 0
  text = text or ""
  for match in pattern.finditer(text):
    if match.start() > pos:
      parts.append(("", text[pos:match.start()]))
    token = match.group(0)
    if token.startswith("**"):
      parts.append(("b", token[2:-2]))
    elif token.startswith("`"):
      parts.append(("code", token[1:-1]))
    else:
      parts.append(("i", token[1:-1]))
    pos = match.end()
  if pos < len(text):
    parts.append(("", text[pos:]))
  return [part for part in parts if part[1]]


def _add_docx_runs(paragraph, text, italic=False):
  for style, chunk in split_inline(text):
    run = paragraph.add_run(chunk)
    if style == "b":
      run.bold = True
    elif style == "i" or italic:
      run.italic = True
    elif style == "code":
      run.font.name = "Consolas"


def build_docx(title, markdown_text):
  from docx.shared import Pt

  doc = Document()
  normal = doc.styles["Normal"]
  normal.font.name = "Calibri"
  normal.font.size = Pt(11)
  if (title or "").strip():
    doc.add_heading(title.strip(), level=0)
  for kind, payload in md_to_blocks(markdown_text):
    if kind in ("h1", "h2", "h3"):
      heading = doc.add_heading(level=int(kind[1]))
      _add_docx_runs(heading, payload)
    elif kind == "p":
      paragraph = doc.add_paragraph()
      _add_docx_runs(paragraph, payload)
    elif kind == "quote":
      from docx.shared import Pt as _Pt

      paragraph = doc.add_paragraph()
      paragraph.paragraph_format.left_indent = _Pt(18)
      _add_docx_runs(paragraph, payload, italic=True)
    elif kind == "code":
      paragraph = doc.add_paragraph()
      run = paragraph.add_run(payload)
      run.font.name = "Consolas"
      run.font.size = Pt(9)
    elif kind in ("ul", "ol"):
      for item in payload:
        paragraph = doc.add_paragraph(
          style="List Bullet" if kind == "ul" else "List Number"
        )
        _add_docx_runs(paragraph, item)
    elif kind == "hr":
      doc.add_paragraph("—" * 12)
  buf = io.BytesIO()
  doc.save(buf)
  buf.seek(0)
  return buf.getvalue()


def build_pdf(title, markdown_text):
  import html as _html

  from reportlab.lib.pagesizes import LETTER
  from reportlab.lib.styles import ParagraphStyle
  from reportlab.lib.units import inch
  from reportlab.platypus import (
    HRFlowable,
    ListFlowable,
    ListItem,
    Paragraph,
    Preformatted,
    SimpleDocTemplate,
    Spacer,
  )

  # Standard PDF fonts only cover WinAnsi: LLM-typical smart punctuation
  # (non-breaking hyphens, curly quotes…) renders as black boxes otherwise.
  _PDF_FIXES = {
    "\u2010": "-", "\u2011": "-", "\u2012": "-", "\u2013": "-",
    "\u2014": "-", "\u2212": "-",
    "\u2018": "'", "\u2019": "'", "\u201a": "'",
    "\u201c": '"', "\u201d": '"', "\u201e": '"',
    "\u2026": "...", "\u00a0": " ", "\u2022": "-",
  }

  def normalize_pdf_text(value):
    for bad, good in _PDF_FIXES.items():
      value = value.replace(bad, good)
    return value

  def esc(value):
    return _html.escape(normalize_pdf_text(value), quote=False)

  def inline_html(text):
    out = []
    for style, chunk in split_inline(text):
      chunk = esc(chunk)
      if style == "b":
        out.append(f"<b>{chunk}</b>")
      elif style == "i":
        out.append(f"<i>{chunk}</i>")
      elif style == "code":
        out.append(f'<font face="Courier" size="9">{chunk}</font>')
      else:
        out.append(chunk)
    return "".join(out) or " "

  base = ParagraphStyle("Base", fontName="Helvetica", fontSize=11, leading=15)
  title_style = ParagraphStyle(
    "DocTitle", parent=base, fontSize=22, leading=26, spaceAfter=12
  )
  heading_styles = {
    "h1": ParagraphStyle("H1", parent=base, fontSize=18, leading=22, spaceBefore=10, spaceAfter=6),
    "h2": ParagraphStyle("H2", parent=base, fontSize=15, leading=19, spaceBefore=8, spaceAfter=5),
    "h3": ParagraphStyle("H3", parent=base, fontSize=13, leading=17, spaceBefore=6, spaceAfter=4),
  }
  quote_style = ParagraphStyle(
    "Quote", parent=base, leftIndent=18, textColor="#555555"
  )
  code_style = ParagraphStyle(
    "Code", parent=base, fontName="Courier", fontSize=9, leading=12,
    backColor="#F2F2F2", borderPadding=6,
  )
  story = []
  if (title or "").strip():
    story += [Paragraph(esc(title.strip()), title_style), Spacer(1, 0.1 * inch)]
  for kind, payload in md_to_blocks(markdown_text):
    if kind in heading_styles:
      story.append(Paragraph(inline_html(payload), heading_styles[kind]))
    elif kind == "p":
      story.append(Paragraph(inline_html(payload), base))
    elif kind == "quote":
      story.append(Paragraph(f"<i>{inline_html(payload)}</i>", quote_style))
    elif kind == "code":
      story.append(Preformatted(esc(payload).replace("\n", "<br/>"), code_style))
    elif kind in ("ul", "ol"):
      story.append(
        ListFlowable(
          [ListItem(Paragraph(inline_html(item), base)) for item in payload],
          bulletType="bullet" if kind == "ul" else "1",
          leftIndent=24,
        )
      )
    elif kind == "hr":
      story.append(HRFlowable(width="100%"))
    story.append(Spacer(1, 0.08 * inch))
  buf = io.BytesIO()
  SimpleDocTemplate(
    buf, pagesize=LETTER, topMargin=0.8 * inch, bottomMargin=0.8 * inch
  ).build(story)
  buf.seek(0)
  return buf.getvalue()


def slug_filename(name, ext):
  safe = re.sub(r"[^A-Za-z0-9-_]+", "-", (name or "nico").strip()).strip("-") or "nico"
  return f"{safe[:60]}.{ext}"


def imagine_url(prompt, width=1024, height=1024, model="flux"):
  """Legacy Pollinations URL builder.

  Kept for reference/tests only: anonymous Pollinations requests now return
  HTTP 402, so /imagine renders via Gemini/Hugging Face instead.
  """
  import urllib.parse

  text = (prompt or "").strip()
  if len(text) < 3:
    raise HTTPException(status_code=400, detail="Describe the image first")
  if len(text) > 500:
    text = text[:500]
  try:
    width = max(256, min(int(width or 1024), 2048))
    height = max(256, min(int(height or 1024), 2048))
  except (TypeError, ValueError):
    width, height = 1024, 1024
  if model not in ("flux", "turbo"):
    model = "flux"
  seed = uuid.uuid4().int % 10_000_000
  return {
    "image_url": (
      f"https://image.pollinations.ai/prompt/{urllib.parse.quote(text)}"
      f"?width={width}&height={height}&seed={seed}&nologo=true&model={model}"
    ),
    "prompt": text,
    "model": model,
    "width": width,
    "height": height,
    "seed": seed,
  }


def downscale_image_bytes(raw: bytes, max_dim=1024, quality=82):
  from PIL import Image

  image = Image.open(io.BytesIO(raw))
  if getattr(image, "is_animated", False):
    image.seek(0)
  image = image.convert("RGB")
  image.thumbnail((max_dim, max_dim), Image.LANCZOS)
  buf = io.BytesIO()
  image.save(buf, format="JPEG", quality=quality)
  return buf.getvalue()


async def render_image_gemini(prompt: str):
  if not gemini_client:
    raise RuntimeError("Gemini is not configured")
  response = await asyncio.to_thread(
    lambda: gemini_client.models.generate_content(
      model="gemini-2.5-flash-image",
      contents=prompt,
      config=types.GenerateContentConfig(response_modalities=["TEXT", "IMAGE"]),
    )
  )
  for part in getattr(response, "parts", None) or []:
    inline = getattr(part, "inline_data", None)
    if inline and getattr(inline, "data", None):
      return bytes(inline.data)
  raise RuntimeError("Gemini returned no image")


async def render_image_hf(prompt: str):
  if not HF_TOKEN:
    raise RuntimeError("token missing")
  payload = {"inputs": prompt}
  headers = {
    "Authorization": f"Bearer {HF_TOKEN}",
    "Content-Type": "application/json",
    "Accept": "image/*",
  }
  response = await asyncio.to_thread(
    lambda: requests.post(
      f"https://api-inference.huggingface.co/models/{HF_IMAGE_MODEL}",
      headers=headers,
      json=payload,
      timeout=180,
    )
  )
  content_type = response.headers.get("Content-Type", "")
  if response.status_code != 200 or not content_type.startswith("image/"):
    raise RuntimeError(f"refused (HTTP {response.status_code})")
  return response.content


def shorten_image_error(error):
  text = str(error)
  if "429" in text or "RESOURCE_EXHAUSTED" in text or "quota" in text.lower():
    return "quota exhausted"
  if "404" in text or "NOT_FOUND" in text:
    return "model retired"
  return text[:120]


async def render_image(prompt: str):
  """Free image rendering: Gemini first, Hugging Face FLUX as fallback."""
  text = (prompt or "").strip()
  if len(text) < 3:
    raise HTTPException(status_code=400, detail="Describe the image first")
  if len(text) > 500:
    text = text[:500]
  errors = []
  try:
    return await render_image_gemini(text), "gemini"
  except HTTPException:
    raise
  except Exception as error:
    errors.append(f"Gemini: {shorten_image_error(error)}")
  try:
    return await render_image_hf(text), "huggingface"
  except HTTPException:
    raise
  except Exception as error:
    errors.append(f"Hugging Face: {shorten_image_error(error)}")
  raise HTTPException(
    status_code=503,
    detail="Image rendering unavailable (" + "; ".join(errors[:2]) + ")",
  )


async def write_doc_markdown(topic, kind):
  # Drop "(title the document ...)" style instructions so the model can't
  # echo them into the heading.
  topic = re.sub(r"\([^)]*title[^)]*\)", "", topic or "", flags=re.IGNORECASE)
  topic = re.sub(r"\s{2,}", " ", topic).strip()
  instruction = (
    f"Write a well-structured {kind.upper()} document about: {topic}. "
    "Use markdown headings, bullet lists, and short paragraphs. "
    "Output only the document, no preamble."
  )
  if groq_client:
    try:
      response = await groq_client.chat.completions.create(
        messages=[{"role": "user", "content": instruction}],
        model="openai/gpt-oss-20b",
        max_tokens=2000,
      )
      text = (response.choices[0].message.content or "").strip()
      if text:
        return text
    except Exception:
      pass
  if OPENCODE_API_KEY and OPENCODE_MODELS:
    try:
      text = (
        await zen_chat_once(
          OPENCODE_MODELS[0], [{"role": "user", "content": instruction}]
        )
      ).strip()
      if text:
        return text
    except Exception:
      pass
  raise HTTPException(status_code=503, detail="No model available to write the document")


class ExportDocRequest(BaseModel):
  title: str = "Nico"
  markdown: str = ""


class ImagineRequest(BaseModel):
  prompt: str = ""
  width: int = 1024
  height: int = 1024
  model: str = "flux"
  conversation_id: str | None = None
  display: str | None = None


class GenerateDocRequest(BaseModel):
  topic: str = ""
  kind: str = "pdf"
  conversation_id: str | None = None
  display: str | None = None
  conversation_id: str | None = None
  display: str | None = None


@app.post("/export/docx")
def export_docx(request: ExportDocRequest):
  data = build_docx(request.title[:120], request.markdown or "")
  return Response(
    content=data,
    media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    headers={
      "Content-Disposition": f'attachment; filename="{slug_filename(request.title, "docx")}"'
    },
  )


@app.post("/export/pdf")
def export_pdf(request: ExportDocRequest):
  data = build_pdf(request.title[:120], request.markdown or "")
  return Response(
    content=data,
    media_type="application/pdf",
    headers={
      "Content-Disposition": f'attachment; filename="{slug_filename(request.title, "pdf")}"'
    },
  )


@app.post("/imagine")
async def imagine(
    request: ImagineRequest,
    authorization: str | None = Header(default=None),
):
  prompt = (request.prompt or "").strip()
  if len(prompt) < 3:
    raise HTTPException(status_code=400, detail="Describe the image first")
  raw, provider = await render_image(prompt)
  try:
    data_url = "data:image/jpeg;base64," + base64.b64encode(
      downscale_image_bytes(raw)
    ).decode("ascii")
  except Exception:
    data_url = "data:image/jpeg;base64," + base64.b64encode(raw).decode("ascii")
  result = {"image_url": data_url, "prompt": prompt[:500], "provider": provider}
  try:
    user = get_current_user(authorization) if authorization else None
  except HTTPException:
    user = None
  if user and request.conversation_id:
    caption = f"**{result['prompt']}**"
    attachments = [{
      "name": "nico-image.jpg",
      "mime_type": "image/jpeg",
      "data_url": data_url,
    }]
    _save_generated_pair(
      user, request.conversation_id,
      (request.display or "").strip() or result["prompt"],
      caption, attachments, f"Nico image: {result['prompt'][:60]}",
    )
  return result


@app.post("/export/generate")
async def export_generate(
    request: GenerateDocRequest,
    authorization: str | None = Header(default=None),
):
  topic = (request.topic or "").strip()
  if len(topic) < 3:
    raise HTTPException(status_code=400, detail="Give a topic first")
  kind = "docx" if request.kind.lower() in ("docx", "word", "doc") else "pdf"
  markdown_text = await write_doc_markdown(topic, kind)
  title = topic[:120]
  if kind == "docx":
    data = build_docx(title, markdown_text)
    mime_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  else:
    data = build_pdf(title, markdown_text)
    mime_type = "application/pdf"
  try:
    user = get_current_user(authorization) if authorization else None
  except HTTPException:
    user = None
  if user and request.conversation_id:
    filename = slug_filename(title, kind)
    attachments = [{
      "name": filename,
      "mime_type": mime_type,
      "data_url": f"data:{mime_type};base64,{base64.b64encode(data).decode('ascii')}",
    }]
    _save_generated_pair(
      user, request.conversation_id,
      (request.display or "").strip() or f"Generate a {kind} about {topic}",
      f"Here's your {kind.upper()} on **{topic}**:",
      attachments, f"Nico document: {title[:60]}",
    )
  return Response(
    content=data,
    media_type=mime_type,
    headers={"Content-Disposition": f'attachment; filename="{slug_filename(title, kind)}"'},
  )


def _now_iso():
  return datetime.utcnow().isoformat(timespec="seconds") + "Z"


def _ensure_convo_for_save(user, conversation_id, fallback_title):
  """Make sure a conversation row exists (and belongs to the user) so
  generated files/images persist as a real chat. Returns True when the
  caller may save messages under it."""
  if not conversation_id:
    return False
  if is_local_demo_user(user):
    user_id = str(user.id)
    DEMO_CONVERSATIONS.setdefault(user_id, {}).setdefault(
      conversation_id,
      {
        "id": conversation_id,
        "title": (fallback_title or "Untitled Chat")[:120],
        "user_id": user_id,
        "created_at": _now_iso(),
      },
    )
    return True
  if not supabase_client:
    return False
  try:
    get_owned_conversation(conversation_id, user.id)
    return True
  except HTTPException:
    pass
  try:
    supabase_client.table("conversations").insert({
      "id": conversation_id,
      "title": (fallback_title or "Untitled Chat")[:120],
      "user_id": user.id,
    }).execute()
    return True
  except Exception:
    return False


def _save_generated_pair(user, conversation_id, user_content, assistant_content,
                         attachments, fallback_title):
  """Persist a generated file/image exchange as a real conversation so it
  shows in the sidebar and reloads later. Best-effort: never raises."""
  try:
    if not _ensure_convo_for_save(user, conversation_id, fallback_title):
      return
    stamp = _now_iso()
    if is_local_demo_user(user):
      user_id = str(user.id)
      DEMO_MESSAGES.setdefault(user_id, {}).setdefault(conversation_id, []).extend([
        {"id": str(uuid.uuid4()), "role": "user", "content": user_content,
         "conversation_id": conversation_id, "created_at": stamp},
        {"id": str(uuid.uuid4()), "role": "assistant", "content": assistant_content,
         "conversation_id": conversation_id, "attachments": attachments,
         "created_at": stamp},
      ])
    else:
      supabase_client.table("messages").insert([
        {"role": "user", "content": user_content,
         "conversation_id": conversation_id},
        {"role": "assistant", "content": assistant_content,
         "conversation_id": conversation_id, "attachments": attachments},
      ]).execute()
  except Exception:
    pass


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


def get_user_badges(user):
  badges = set()
  user_id = str(user.id)
  if is_local_demo_user(user):
    for item in DEMO_BADGES.get(user_id, []):
      if item.get("badge") in GRANTABLE_BADGES:
        badges.add(item["badge"])
  else:
    try:
      rows = (
          supabase_client.table("user_badges")
          .select("badge")
          .eq("user_id", user_id)
          .execute()
      ).data or []
      for row in rows:
        if row.get("badge") in GRANTABLE_BADGES:
          badges.add(row["badge"])
    except Exception:
      pass
  if is_developer_identity(user):
    badges.add("admin")
  elif ((getattr(user, "user_metadata", {}) or {}).get("role") or "").lower() == "developer":
    # Mirror the frontend Developer check so role-based admin accounts
    # get the same treatment (e.g. Nemotron-first routing).
    badges.add("admin")
  return badges


def resolve_badge_user(email: str):
  key = (email or "").strip().lower()
  if not key:
    return None, None
  if key in DEMO_USERS:
    return DEMO_USERS[key]["id"], DEMO_USERS[key]["email"]
  if supabase_client:
    try:
      for candidate in supabase_client.auth.admin.list_users() or []:
        if ((getattr(candidate, "email", "") or "").lower()) == key:
          return str(candidate.id), candidate.email
    except Exception:
      pass
  return None, None


@app.get("/admin/badges")
def admin_list_badges(authorization: str | None = Header(default=None)):
  require_admin(authorization)
  items: list[dict] = []
  for user_id, badges in DEMO_BADGES.items():
    email = next(
      (u["email"] for u in DEMO_USERS.values() if str(u["id"]) == str(user_id)),
      user_id,
    )
    for item in badges:
      items.append({"user_id": user_id, "email": email, **item})
  if supabase_client:
    try:
      rows = supabase_client.table("user_badges").select(
          "user_id, badge, granted_at"
      ).order("granted_at", desc=True).limit(500).execute().data or []
      emails: dict[str, str] = {}
      try:
        for candidate in supabase_client.auth.admin.list_users() or []:
          emails[str(candidate.id)] = candidate.email or str(candidate.id)
      except Exception:
        pass
      for row in rows:
        items.append({
          "user_id": row["user_id"],
          "email": emails.get(str(row["user_id"]), str(row["user_id"])),
          "badge": row["badge"],
          "granted_at": row.get("granted_at"),
        })
    except Exception:
      pass  # table not migrated yet; demo badges still listed
  return {"badges": items}


class BadgeGrantRequest(BaseModel):
  email: str
  badge: str


@app.post("/admin/badges")
def admin_grant_badge(
    request: BadgeGrantRequest,
    authorization: str | None = Header(default=None),
):
  require_admin(authorization)
  badge = (request.badge or "").strip().lower()
  if badge not in GRANTABLE_BADGES:
    raise HTTPException(
      status_code=400,
      detail=f"Badge must be one of: {', '.join(sorted(GRANTABLE_BADGES))}",
    )
  user_id, email = resolve_badge_user(request.email)
  if not user_id:
    raise HTTPException(status_code=404, detail="No account found for that email")
  now = datetime.utcnow().isoformat(timespec="seconds") + "Z"
  if any(str(item.get("id")) == str(user_id) for item in DEMO_USERS.values()):
    badges = DEMO_BADGES.setdefault(str(user_id), [])
    if not any(item.get("badge") == badge for item in badges):
      badges.append({"user_id": str(user_id), "badge": badge, "granted_at": now})
    add_admin_log(f"Granted {badge} to {email}")
    return {"status": "success", "badge": badge, "email": email}
  require_supabase()
  try:
    existing = (
        supabase_client.table("user_badges")
        .select("badge")
        .eq("user_id", user_id)
        .eq("badge", badge)
        .limit(1)
        .execute()
    ).data or []
    if not existing:
      supabase_client.table("user_badges").insert(
          {"user_id": user_id, "badge": badge}
      ).execute()
  except Exception as error:
    raise HTTPException(
      status_code=503,
      detail="Badges table is missing. Run the user_badges migration in Supabase, then redeploy.",
    ) from error
  add_admin_log(f"Granted {badge} to {email}")
  return {"status": "success", "badge": badge, "email": email}


@app.delete("/admin/badges")
def admin_revoke_badge(
    request: BadgeGrantRequest,
    authorization: str | None = Header(default=None),
):
  require_admin(authorization)
  badge = (request.badge or "").strip().lower()
  user_id, email = resolve_badge_user(request.email)
  if not user_id:
    raise HTTPException(status_code=404, detail="No account found for that email")
  if str(user_id) in DEMO_BADGES:
    DEMO_BADGES[str(user_id)] = [
      item for item in DEMO_BADGES[str(user_id)] if item.get("badge") != badge
    ]
  if supabase_client:
    try:
      supabase_client.table("user_badges").delete().eq(
          "user_id", user_id
      ).eq("badge", badge).execute()
    except Exception:
      pass
  add_admin_log(f"Revoked {badge} from {email}")
  return {"status": "success"}


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
):
  if not groq_client and not (OPENCODE_API_KEY and OPENCODE_MODELS):
    raise HTTPException(status_code=503, detail="No chat provider is configured")
  user = get_current_user(authorization) if authorization else None
  is_guest = user is None
  is_admin_user = is_developer_identity(user) if user else False
  # Zen fallback is reserved for badged accounts (admins included).
  can_use_zen = bool(user) and bool(get_user_badges(user))

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
        generated_title = await generate_title(request.message, can_use_zen)
        user_conversations[request.conversation_id] = {
            "id": request.conversation_id,
            "title": generated_title,
            "user_id": user_id,
            "created_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        }
      history = user_messages.get(request.conversation_id, [])
      past_messages = history if request.settings.get("context", True) else []
      user_messages.setdefault(request.conversation_id, []).append({
          "id": request.client_message_id or str(uuid.uuid4()),
          "client_id": request.client_message_id,
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
        generated_title = await generate_title(request.message, can_use_zen)

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
          "client_id": request.client_message_id,
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
        if can_use_zen and OPENCODE_API_KEY and OPENCODE_MODELS:
          # Badged: Nemotron first, Groq as backup.
          models_to_try += [("zen", name) for name in OPENCODE_MODELS]
        if groq_client:
          models_to_try.append((
            "groq",
            "openai/gpt-oss-20b"
            if request.settings.get("model") == "light"
            else "openai/gpt-oss-120b",
          ))
      last_error = None

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
        full_reply = format_response(full_reply)
        yield full_reply
      elif not full_reply and not models_to_try:
        full_reply = "Nico has no chat provider available right now. Try again in a bit."
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