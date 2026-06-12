import json

from hermes_cli.session_legacy import (
    delete_legacy_session,
    get_legacy_session,
    list_legacy_sessions,
)


def _write_session(home, session_id, messages):
    sessions = home / "sessions"
    sessions.mkdir(parents=True, exist_ok=True)
    path = sessions / f"session_{session_id}.json"
    path.write_text(
        json.dumps(
            {
                "session_id": session_id,
                "platform": "cli",
                "model": "test/model",
                "messages": messages,
            }
        ),
        encoding="utf-8",
    )
    return path


def test_lists_only_json_sessions_missing_from_database(tmp_path):
    home = tmp_path / "work"
    _write_session(home, "json-only", [{"role": "user", "content": "first request"}])
    _write_session(home, "modern", [{"role": "user", "content": "already migrated"}])

    rows = list_legacy_sessions([("work", home)], {"work": {"modern"}})

    assert [row["id"] for row in rows] == ["json-only"]
    assert rows[0]["profile"] == "work"
    assert rows[0]["preview"] == "first request"


def test_detail_prefers_real_compaction_summary(tmp_path):
    home = tmp_path / "life"
    _write_session(
        home,
        "summary",
        [
            {"role": "assistant", "content": "ordinary assistant response"},
            {
                "role": "system",
                "content": "[CONTEXT COMPACTION — REFERENCE ONLY]\nSummary below.\nThe durable summary.",
            },
        ],
    )

    detail = get_legacy_session(home, "life", "summary")

    assert detail["summary"] == "The durable summary."
    assert len(detail["messages"]) == 2


def test_delete_removes_snapshot_and_registry_reference(tmp_path):
    home = tmp_path / "default"
    path = _write_session(home, "gone", [{"role": "user", "content": "delete me"}])
    registry = home / "sessions" / "sessions.json"
    registry.write_text(
        json.dumps(
            {
                "keep": {"session_id": "keep"},
                "gone": {"session_id": "gone"},
            }
        ),
        encoding="utf-8",
    )

    assert delete_legacy_session(home, "gone") is True
    assert not path.exists()
    assert json.loads(registry.read_text(encoding="utf-8")) == {"keep": {"session_id": "keep"}}
