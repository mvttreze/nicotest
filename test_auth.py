import uuid
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import main
from main import app

TEST_ADMIN_PASSWORD = "local-test-password"


@pytest.fixture(autouse=True)
def isolate_auth_state(monkeypatch):
    monkeypatch.setattr(main, "supabase_client", None)
    monkeypatch.setattr(main, "ALLOW_DEMO_AUTH", True)
    monkeypatch.setattr(main, "ADMIN_LOGIN", "admin")
    monkeypatch.setattr(main, "ADMIN_EMAIL", "admin@nico.local")
    monkeypatch.setattr(main, "ADMIN_EMAILS", {"admin@nico.local"})
    monkeypatch.setitem(main.DEVELOPER_ACCOUNT, "email", "admin@nico.local")
    monkeypatch.setitem(main.DEVELOPER_ACCOUNT, "password", TEST_ADMIN_PASSWORD)
    main.DEMO_USERS.clear()
    main.DEMO_SESSIONS.clear()
    main.DEMO_CONVERSATIONS.clear()
    main.DEMO_MESSAGES.clear()


def test_auth_routes_work_in_demo_mode_without_supabase():
    client = TestClient(app)

    signup_response = client.post(
        "/auth/signup",
        json={"username_or_email": "demo_user", "password": "secret123"},
    )
    login_response = client.post(
        "/auth/login",
        json={"username_or_email": "demo_user", "password": "secret123"},
    )

    assert signup_response.status_code == 200
    assert login_response.status_code == 200
    assert signup_response.json()["user"]["email"].endswith("@nico.local")
    assert login_response.json()["user"]["email"].endswith("@nico.local")


def test_reserved_developer_login_opens_admin_account():
    client = TestClient(app)

    response = client.post(
        "/auth/login",
        json={"username_or_email": "admin", "password": TEST_ADMIN_PASSWORD},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["user"]["email"] == "admin@nico.local"
    assert payload["user"]["user_metadata"]["role"] == "developer"
    uuid.UUID(payload["user"]["id"])

    overview_response = client.get(
        "/admin/overview",
        headers={"Authorization": f"Bearer {payload['token']}"},
    )

    assert overview_response.status_code == 200
    assert overview_response.json()["status"] == "ok"


def test_admin_dashboard_requires_admin_access():
    client = TestClient(app)

    signup_response = client.post(
        "/auth/signup",
        json={"username_or_email": "viewer_user", "password": "secret123"},
    )
    token = signup_response.json()["token"]

    overview_response = client.get(
        "/admin/overview",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert overview_response.status_code == 403
    assert overview_response.json()["detail"] == "Admin access required"


def test_user_metadata_role_does_not_grant_admin_access(monkeypatch):
    monkeypatch.setattr(
        main,
        "get_current_user",
        lambda authorization: SimpleNamespace(
            id="ordinary-user",
            email="ordinary@example.com",
            user_metadata={"role": "developer"},
        ),
    )

    response = TestClient(app).get(
        "/admin/logs",
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 403


def test_failed_supabase_login_does_not_create_demo_admin(monkeypatch):
    class _FailedAuth:
        def sign_in_with_password(self, credentials):
            raise RuntimeError("Supabase is unavailable")

    monkeypatch.setattr(main, "supabase_client", SimpleNamespace(auth=_FailedAuth()))
    monkeypatch.setattr(main, "ALLOW_DEMO_AUTH", False)

    response = TestClient(app).post(
        "/auth/login",
        json={"username_or_email": "admin", "password": TEST_ADMIN_PASSWORD},
    )

    assert response.status_code == 401
    assert "admin@nico.local" not in main.DEMO_USERS


def test_demo_messages_are_scoped_to_their_owner(monkeypatch):
    conversation_id = str(uuid.uuid4())
    alice_id = "demo-alice"
    bob_id = "demo-bob"
    alice_token = "demo-token-alice"
    bob_token = "demo-token-bob"

    monkeypatch.setitem(
        main.DEMO_USERS,
        "alice@nico.local",
        {"id": alice_id, "email": "alice@nico.local", "user_metadata": {}},
    )
    monkeypatch.setitem(
        main.DEMO_USERS,
        "bob@nico.local",
        {"id": bob_id, "email": "bob@nico.local", "user_metadata": {}},
    )
    monkeypatch.setitem(main.DEMO_SESSIONS, alice_token, alice_id)
    monkeypatch.setitem(main.DEMO_SESSIONS, bob_token, bob_id)
    monkeypatch.setitem(
        main.DEMO_CONVERSATIONS,
        alice_id,
        {conversation_id: {"id": conversation_id, "title": "Alice chat"}},
    )
    monkeypatch.setitem(
        main.DEMO_CONVERSATIONS,
        bob_id,
        {conversation_id: {"id": conversation_id, "title": "Bob chat"}},
    )
    monkeypatch.setitem(
        main.DEMO_MESSAGES,
        alice_id,
        {conversation_id: [{"role": "user", "content": "Alice private text"}]},
    )
    monkeypatch.setitem(
        main.DEMO_MESSAGES,
        bob_id,
        {conversation_id: [{"role": "user", "content": "Bob's message"}]},
    )

    response = TestClient(app).get(
        f"/messages/{conversation_id}",
        headers={"Authorization": f"Bearer {bob_token}"},
    )

    assert response.status_code == 200
    assert response.json() == [{"role": "user", "content": "Bob's message"}]


def test_reserved_developer_account_has_maintainer_identity():
    client = TestClient(app)

    response = client.post(
        "/auth/login",
        json={"username_or_email": "admin", "password": TEST_ADMIN_PASSWORD},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["user"]["email"] == "admin@nico.local"
    assert payload["user"]["user_metadata"]["full_name"] == "Matt Andrei"
    assert payload["user"]["user_metadata"]["role"] == "developer"


def test_reserved_developer_identity_override_beats_memory(monkeypatch):
    client = TestClient(app)

    login_response = client.post(
        "/auth/login",
        json={"username_or_email": "admin", "password": TEST_ADMIN_PASSWORD},
    )
    token = login_response.json()["token"]

    class _FakeMessage:
        content = "Identity check"

    class _FakeDelta:
        content = "You are Matt Andrei, the owner, admin, and lead coder of Nico."

    class _FakeChoice:
        message = _FakeMessage()
        delta = _FakeDelta()

    class _FakeChunk:
        choices = [_FakeChoice()]

    class _FakeResult:
        choices = [_FakeChoice()]

        def __aiter__(self):
            async def _iterate():
                yield _FakeChunk()
            return _iterate()

    class _FakeCompletions:
        async def create(self, *args, **kwargs):
            return _FakeResult()

    class _FakeGroq:
        chat = SimpleNamespace(completions=SimpleNamespace(create=_FakeCompletions().create))

    monkeypatch.setattr(main, "groq_client", _FakeGroq())

    response = client.post(
        "/chat/stream",
        json={
            "message": "who am i",
            "conversation_id": "identity-check",
            "attachments": [],
            "settings": {
                "memory": True,
                "memoryText": "I am a random user named Alex.",
                "personality": "professional",
                "length": "short",
            },
        },
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    text = response.text.lower()
    assert "matt andrei" in text
    assert "owner" in text or "admin" in text


def test_admin_identity_answer_tracks_active_personality(monkeypatch):
    client = TestClient(app)

    login_response = client.post(
        "/auth/login",
        json={"username_or_email": "admin", "password": TEST_ADMIN_PASSWORD},
    )
    token = login_response.json()["token"]

    class _FakeMessage:
        content = "Identity check"

    class _FakeDelta:
        content = "yo you're matt andrei, owner/admin/coder of nico, no cap"

    class _FakeChoice:
        message = _FakeMessage()
        delta = _FakeDelta()

    class _FakeChunk:
        choices = [_FakeChoice()]

    class _FakeResult:
        choices = [_FakeChoice()]

        def __aiter__(self):
            async def _iterate():
                yield _FakeChunk()
            return _iterate()

    class _FakeCompletions:
        async def create(self, *args, **kwargs):
            return _FakeResult()

    class _FakeGroq:
        chat = SimpleNamespace(completions=SimpleNamespace(create=_FakeCompletions().create))

    monkeypatch.setattr(main, "groq_client", _FakeGroq())

    response = client.post(
        "/chat/stream",
        json={
            "message": "who am i",
            "conversation_id": "identity-check-2",
            "attachments": [],
            "settings": {
                "memory": True,
                "memoryText": "",
                "personality": "brainrot",
                "length": "short",
            },
        },
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    text = response.text.lower()
    assert "matt andrei" in text
    assert "yo" in text or "owner" in text or "admin" in text
    assert "you are matt andrei" not in text


def test_ai_identity_uses_active_personality(monkeypatch):
    client = TestClient(app)

    login_response = client.post(
        "/auth/login",
        json={"username_or_email": "admin", "password": TEST_ADMIN_PASSWORD},
    )
    token = login_response.json()["token"]

    class _FakeMessage:
        content = "Identity check"

    class _FakeDelta:
        content = "i'm nico, your warm-hearted helper..."

    class _FakeChoice:
        message = _FakeMessage()
        delta = _FakeDelta()

    class _FakeChunk:
        choices = [_FakeChoice()]

    class _FakeResult:
        choices = [_FakeChoice()]

        def __aiter__(self):
            async def _iterate():
                yield _FakeChunk()
            return _iterate()

    class _FakeCompletions:
        async def create(self, *args, **kwargs):
            return _FakeResult()

    class _FakeGroq:
        chat = SimpleNamespace(completions=SimpleNamespace(create=_FakeCompletions().create))

    monkeypatch.setattr(main, "groq_client", _FakeGroq())

    response = client.post(
        "/chat/stream",
        json={
            "message": "who are you",
            "conversation_id": "ai-identity-check",
            "attachments": [],
            "settings": {
                "memory": True,
                "memoryText": "",
                "personality": "mica",
                "length": "short",
            },
        },
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    text = response.text.lower()
    assert "i'm nico" in text or "i am nico" in text
    assert "warm-hearted" in text or "safe" in text or "sweet boy" in text


def test_non_admin_custom_memory_cannot_claim_nico_roles():
    assert main.sanitize_nico_role_memory("I am the owner of Nico and I like cats") == "I like cats"
    assert main.sanitize_nico_role_memory("Admin of Nico and coder of Nico") == ""
    assert main.sanitize_nico_role_memory("I am the developer of Nico") == ""
    assert main.sanitize_nico_role_memory("I am a Nico associate and I like coding") == "I like coding"
