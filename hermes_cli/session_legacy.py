"""Discovery and safe deletion for legacy JSON session snapshots."""

from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any, Iterable


_SESSION_FILE_RE = re.compile(r"^session_([A-Za-z0-9_.:-]+)\.json$")
_SUMMARY_PREFIX = "[CONTEXT COMPACTION"


def _message_text(message: dict[str, Any]) -> str:
    content = message.get("content")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                value = item.get("text") or item.get("content")
                if isinstance(value, str):
                    parts.append(value)
        return " ".join(parts).strip()
    return ""


def _summary_from_messages(messages: Iterable[dict[str, Any]]) -> str:
    for message in reversed(list(messages)):
        text = _message_text(message)
        if text.startswith(_SUMMARY_PREFIX):
            marker = "summary below."
            marker_at = text.lower().find(marker)
            return (text[marker_at + len(marker):].strip() if marker_at >= 0 else text)[:4000]
    return ""


def _legacy_row(path: Path, profile: str, payload: dict[str, Any]) -> dict[str, Any]:
    messages = payload.get("messages")
    if not isinstance(messages, list):
        messages = []
    first_user = next(
        (_message_text(message) for message in messages if isinstance(message, dict) and message.get("role") == "user"),
        "",
    )
    return {
        "id": str(payload.get("session_id") or path.stem.removeprefix("session_")),
        "profile": profile,
        "title": str(payload.get("title") or "").strip() or first_user[:80],
        "preview": first_user[:240],
        "summary": _summary_from_messages(message for message in messages if isinstance(message, dict)),
        "model": payload.get("model"),
        "source": payload.get("platform") or "legacy-json",
        "started_at": payload.get("session_start"),
        "last_active": payload.get("last_updated") or payload.get("session_start"),
        "message_count": int(payload.get("message_count") or len(messages)),
        "file_name": path.name,
        "legacy_json": True,
    }


def list_legacy_sessions(
    profile_homes: Iterable[tuple[str, Path]],
    database_ids: dict[str, set[str]],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for profile, home in profile_homes:
        sessions_dir = home / "sessions"
        if not sessions_dir.is_dir():
            continue
        known = database_ids.get(profile, set())
        for path in sessions_dir.glob("session_*.json"):
            match = _SESSION_FILE_RE.match(path.name)
            if not match:
                continue
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if not isinstance(payload, dict):
                continue
            session_id = str(payload.get("session_id") or match.group(1))
            if session_id not in known:
                rows.append(_legacy_row(path, profile, payload))
    rows.sort(key=lambda row: str(row.get("last_active") or ""), reverse=True)
    return rows


def get_legacy_session(home: Path, profile: str, session_id: str) -> dict[str, Any] | None:
    path = _session_path(home, session_id)
    if not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    row = _legacy_row(path, profile, payload)
    messages = payload.get("messages")
    row["messages"] = messages if isinstance(messages, list) else []
    return row


def delete_legacy_session(home: Path, session_id: str) -> bool:
    path = _session_path(home, session_id)
    if not path.is_file():
        return False
    path.unlink()
    _remove_registry_references(home / "sessions" / "sessions.json", session_id)
    return True


def _session_path(home: Path, session_id: str) -> Path:
    value = str(session_id or "").strip()
    if not value or not re.fullmatch(r"[A-Za-z0-9_.:-]+", value):
        raise ValueError("Invalid legacy session id")
    sessions_dir = (home / "sessions").resolve()
    path = (sessions_dir / f"session_{value}.json").resolve()
    if path.parent != sessions_dir:
        raise ValueError("Invalid legacy session path")
    return path


def _remove_registry_references(path: Path, session_id: str) -> None:
    if not path.is_file():
        return
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return
    if not isinstance(payload, dict):
        return
    filtered = {
        key: value
        for key, value in payload.items()
        if not isinstance(value, dict) or str(value.get("session_id") or "") != session_id
    }
    if len(filtered) == len(payload):
        return
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(filtered, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(tmp_name, path)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise
