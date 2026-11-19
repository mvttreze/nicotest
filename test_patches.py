from pathlib import Path
import pytest
from fastapi.testclient import TestClient

import main


TEST_ADMIN_PASSWORD = "local-patch-test-password"


@pytest.fixture
def patch_client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "supabase_client", None)
    monkeypatch.setattr(main, "ALLOW_DEMO_AUTH", True)
    monkeypatch.setattr(main, "ADMIN_LOGIN", "admin")
    monkeypatch.setattr(main, "ADMIN_EMAIL", "admin@nico.local")
    monkeypatch.setattr(main, "ADMIN_EMAILS", {"admin@nico.local"})
    monkeypatch.setitem(main.DEVELOPER_ACCOUNT, "email", "admin@nico.local")
    monkeypatch.setitem(main.DEVELOPER_ACCOUNT, "password", TEST_ADMIN_PASSWORD)
    main.DEMO_USERS.clear()
    main.DEMO_SESSIONS.clear()
    monkeypatch.setattr(main, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(main, "PATCHES_PATH", str(tmp_path / "patches.json"))
    monkeypatch.setattr(main, "PATCH_FILES", {"nico-redesign.css"})
    main._PATCHES.clear()
    (tmp_path / "nico-redesign.css").write_text("body { color: white; }\n", encoding="utf-8")

    client = TestClient(main.app)
    login = client.post(
        "/auth/login",
        json={"username_or_email": "admin", "password": TEST_ADMIN_PASSWORD},
    )
    assert login.status_code == 200
    return client, login.json()["token"], tmp_path / "nico-redesign.css"


def test_patch_routes_require_admin(patch_client):
    client, _, _ = patch_client
    signup = client.post(
        "/auth/signup",
        json={"username_or_email": "patch-viewer", "password": "viewer-password"},
    )
    token = signup.json()["token"]
    response = client.get("/admin/patches", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 403


def test_patch_snapshot_preview_restore_and_backup(patch_client):
    client, token, target = patch_client
    headers = {"Authorization": f"Bearer {token}"}
    original = target.read_text(encoding="utf-8")

    created = client.post(
        "/admin/patches",
        headers=headers,
        json={"target": target.name, "description": "Original monochrome UI", "content": original, "confirm": True},
    )
    assert created.status_code == 200
    patch_id = created.json()["id"]

    target.write_text("body { color: black; }\n", encoding="utf-8")
    preview = client.get(f"/admin/patches/{patch_id}/preview", headers=headers)
    assert preview.status_code == 200
    assert "color: black" in preview.json()["diff"]
    assert "color: white" in preview.json()["diff"]

    restored = client.post(
        f"/admin/patches/{patch_id}/restore",
        headers=headers,
        json={"confirm": True, "note": "test restore"},
    )
    assert restored.status_code == 200
    assert target.read_text(encoding="utf-8") == original
    assert restored.json()["backup_id"]

    listing = client.get("/admin/patches", headers=headers)
    assert listing.status_code == 200
    assert listing.json()["patches"][0]["kind"] == "backup"


def test_patch_target_allowlist_blocks_path_traversal(patch_client):
    client, token, _ = patch_client
    response = client.post(
        "/admin/patches",
        headers={"Authorization": f"Bearer {token}"},
        json={"target": "../.env", "description": "not allowed", "content": "secret", "confirm": True},
    )
    assert response.status_code == 403
