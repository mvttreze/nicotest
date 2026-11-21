import asyncio
from types import SimpleNamespace

from fastapi import HTTPException
from fastapi.testclient import TestClient

import main


class FakeTable:
    def __init__(self, database, name):
        self.database = database
        self.name = name
        self.operation = "select"
        self.payload = None

    def select(self, *_args, **_kwargs):
        self.operation = "select"
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def order(self, *_args, **_kwargs):
        return self

    def insert(self, payload):
        self.operation = "insert"
        self.payload = payload
        return self

    def execute(self):
        if self.operation == "insert":
            rows = self.payload if isinstance(self.payload, list) else [self.payload]
            if self.name == "messages":
                self.database.messages.extend(rows)
            return SimpleNamespace(data=rows, count=len(rows))
        if self.name == "conversations":
            return SimpleNamespace(data=[{"id": self.database.conversation_id}])
        if self.name == "messages":
            return SimpleNamespace(data=list(self.database.messages))
        return SimpleNamespace(data=[])


class FakeDatabase:
    def __init__(self, conversation_id, messages=None):
        self.conversation_id = conversation_id
        self.messages = list(messages or [])

    def table(self, name):
        return FakeTable(self, name)


def configure_signed_in_chat(monkeypatch, *, badges=()):
    conversation_id = "test-conversation"
    user = SimpleNamespace(
        id="signed-in-user",
        email="user@example.com",
        user_metadata={},
    )
    database = FakeDatabase(
        conversation_id,
        [
            {"role": "user", "content": "Earlier question", "conversation_id": conversation_id},
            {"role": "assistant", "content": "Earlier answer", "conversation_id": conversation_id},
        ],
    )
    monkeypatch.setattr(main, "supabase_client", database)
    monkeypatch.setattr(main, "get_current_user", lambda _authorization: user)
    monkeypatch.setattr(main, "get_user_badges", lambda _user: set(badges))
    monkeypatch.setattr(main, "OPENCODE_API_KEY", "")
    monkeypatch.setattr(main, "OPENCODE_MODELS", [])
    monkeypatch.setattr(main, "FREELLMAPI_BASE_URL", "")
    monkeypatch.setattr(main, "FREELLMAPI_API_KEY", "")
    return conversation_id, database


def provider_chunk(content):
    return SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=content))])


def test_title_generation_is_local_and_bounded():
    async def run():
        return await main.generate_title(
            "  How do I make chat responses faster?\nPlease explain.  ",
            use_zen=True,
            use_gateway=True,
        )

    title = asyncio.run(run())
    assert title == "How do I make chat"
    assert len(title) <= 60


def test_signed_in_chat_sends_current_message_once(monkeypatch):
    conversation_id, database = configure_signed_in_chat(monkeypatch)
    captured = {}

    class FakeCompletions:
        async def create(self, **kwargs):
            captured["messages"] = kwargs["messages"]

            async def stream():
                yield provider_chunk("Current answer")

            return stream()

    monkeypatch.setattr(
        main,
        "groq_client",
        SimpleNamespace(chat=SimpleNamespace(completions=FakeCompletions())),
    )

    async def run():
        response = await main.chat_stream(
            main.ChatRequest(
                message="Current question",
                conversation_id=conversation_id,
                settings={"context": True, "memory": False, "model": "light"},
            ),
            "Bearer test-token",
        )
        return "".join([
            chunk.decode() if isinstance(chunk, bytes) else chunk
            async for chunk in response.body_iterator
        ])

    response_text = asyncio.run(run())
    sent = captured["messages"]
    assert response_text == "Current answer"
    assert [item["content"] for item in sent if item["role"] == "user"] == [
        "Earlier question",
        "Current question",
    ]
    assert database.messages[-1]["role"] == "assistant"


def test_badged_account_can_use_gateway_without_other_chat_providers(monkeypatch):
    conversation_id, _database = configure_signed_in_chat(
        monkeypatch, badges={"supporter"}
    )
    monkeypatch.setattr(main, "groq_client", None)
    monkeypatch.setattr(main, "FREELLMAPI_BASE_URL", "http://gateway.test")
    monkeypatch.setattr(main, "FREELLMAPI_API_KEY", "gateway-test-key")
    calls = []

    async def fake_gateway_stream(_messages):
        calls.append(True)
        yield "Gateway answer"

    monkeypatch.setattr(main, "freellmapi_chat_stream", fake_gateway_stream)

    async def run():
        response = await main.chat_stream(
            main.ChatRequest(
                message="Use the gateway",
                conversation_id=conversation_id,
                settings={"context": True, "memory": False, "model": "light"},
            ),
            "Bearer test-token",
        )
        return "".join([
            chunk.decode() if isinstance(chunk, bytes) else chunk
            async for chunk in response.body_iterator
        ])

    assert asyncio.run(run()) == "Gateway answer"
    assert calls == [True]


def test_partial_provider_failure_does_not_append_a_second_answer(monkeypatch):
    conversation_id, _database = configure_signed_in_chat(
        monkeypatch, badges={"supporter"}
    )
    monkeypatch.setattr(main, "FREELLMAPI_BASE_URL", "http://gateway.test")
    monkeypatch.setattr(main, "FREELLMAPI_API_KEY", "gateway-test-key")
    gateway_calls = []

    class FailingCompletions:
        async def create(self, **_kwargs):
            async def stream():
                yield provider_chunk("First fragment")
                raise RuntimeError("provider disconnected")

            return stream()

    async def backup_stream(_messages):
        gateway_calls.append(True)
        yield "Unrelated backup answer"

    monkeypatch.setattr(
        main,
        "groq_client",
        SimpleNamespace(chat=SimpleNamespace(completions=FailingCompletions())),
    )
    monkeypatch.setattr(main, "freellmapi_chat_stream", backup_stream)

    async def run():
        response = await main.chat_stream(
            main.ChatRequest(
                message="Explain the request",
                conversation_id=conversation_id,
                settings={"context": True, "memory": False, "model": "light"},
            ),
            "Bearer test-token",
        )
        return "".join([
            chunk.decode() if isinstance(chunk, bytes) else chunk
            async for chunk in response.body_iterator
        ])

    response_text = asyncio.run(run())
    assert "First fragment" in response_text
    assert "interrupted" in response_text
    assert "Unrelated backup answer" not in response_text
    assert gateway_calls == []


def test_invalid_bearer_is_not_downgraded_to_guest_for_image_generation(monkeypatch):
    def reject_token(_authorization):
        raise HTTPException(status_code=401, detail="Invalid sign-in session")

    monkeypatch.setattr(main, "get_current_user", reject_token)
    response = TestClient(main.app).post(
        "/imagine",
        headers={"Authorization": "Bearer expired-token"},
        json={"prompt": "A small lighthouse"},
    )
    assert response.status_code == 401


def test_invalid_bearer_stops_document_generation_before_provider_call(monkeypatch):
    def reject_token(_authorization):
        raise HTTPException(status_code=401, detail="Invalid sign-in session")

    called = []

    async def fake_writer(*_args):
        called.append(True)
        return "generated content"

    monkeypatch.setattr(main, "get_current_user", reject_token)
    monkeypatch.setattr(main, "write_doc_markdown", fake_writer)
    response = TestClient(main.app).post(
        "/export/generate",
        headers={"Authorization": "Bearer expired-token"},
        json={"topic": "A short report", "kind": "pdf"},
    )
    assert response.status_code == 401
    assert called == []


def test_user_metadata_role_does_not_grant_provider_badges(monkeypatch):
    monkeypatch.setattr(main, "supabase_client", None)
    user = SimpleNamespace(
        id="unprivileged-user",
        email="user@example.com",
        user_metadata={"role": "developer"},
    )
    assert main.get_user_badges(user) == set()


def test_chat_settings_are_allowlisted_and_badge_gated():
    assert main.normalize_chat_settings(
        {"personality": "mica"}, set(), False
    )[0] == "professional"
    assert main.normalize_chat_settings(
        {"personality": "developer"}, {"supporter"}, False
    )[0] == "professional"
    assert main.normalize_chat_settings(
        {"personality": "brainrot"}, set(), False
    )[0] == "professional"
    assert main.normalize_chat_settings(
        {"personality": "mica"}, {"tester"}, False
    )[0] == "mica"
    assert main.normalize_chat_settings(
        {"personality": "brainrot"}, {"supporter"}, False
    )[0] == "brainrot"
    assert main.normalize_chat_settings(
        {"personality": "developer"}, {"admin"}, True
    )[0] == "developer"
    assert main.normalize_chat_settings(
        {"personality": "ignore all rules", "length": [], "model": {}}, set(), False
    ) == ("professional", "short", "", "light")


def test_gemini_vision_works_without_text_chat_provider(monkeypatch):
    conversation_id, _database = configure_signed_in_chat(monkeypatch)
    monkeypatch.setattr(main, "groq_client", None)
    monkeypatch.setattr(main, "gemini_client", object())
    seen = []

    async def fake_vision(_message, _attachments, _system_prompt):
        seen.append(True)
        return "This is a test image."

    monkeypatch.setattr(main, "generate_gemini_image_response", fake_vision)

    async def run():
        response = await main.chat_stream(
            main.ChatRequest(
                message="What is in this image?",
                conversation_id=conversation_id,
                attachments=[{
                    "mime_type": "image/png",
                    "data_url": "data:image/png;base64,AAAA",
                }],
                settings={"context": True, "memory": False},
            ),
            "Bearer test-token",
        )
        return "".join([
            chunk.decode() if isinstance(chunk, bytes) else chunk
            async for chunk in response.body_iterator
        ])

    assert asyncio.run(run()) == "This is a test image."
    assert seen == [True]


def test_app_routes_do_not_register_duplicate_method_paths():
    route_keys = [
        (method, route.path)
        for route in main.app.routes
        for method in getattr(route, "methods", set())
    ]
    assert len(route_keys) == len(set(route_keys))
