from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from backend.config import BASE_DIR

DB_PATH = BASE_DIR / "data" / "app.db"


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS downloads (
                id TEXT PRIMARY KEY,
                url TEXT NOT NULL,
                video_id TEXT,
                title TEXT,
                channel TEXT,
                thumbnail TEXT,
                kind TEXT NOT NULL,
                format_id TEXT,
                format_selector TEXT NOT NULL,
                label TEXT,
                container TEXT,
                expected_size INTEGER,
                status TEXT NOT NULL,
                progress REAL DEFAULT 0,
                speed INTEGER,
                eta INTEGER,
                filepath TEXT,
                error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_dl_created ON downloads(created_at DESC)"
        )


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return dict(row)


def insert_download(record: dict[str, Any]) -> None:
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO downloads (
                id, url, video_id, title, channel, thumbnail, kind, format_id,
                format_selector, label, container, expected_size, status, progress,
                speed, eta, filepath, error, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record["id"],
                record["url"],
                record.get("video_id"),
                record.get("title"),
                record.get("channel"),
                record.get("thumbnail"),
                record["kind"],
                record.get("format_id"),
                record["format_selector"],
                record.get("label"),
                record.get("container"),
                record.get("expected_size"),
                record["status"],
                record.get("progress", 0),
                record.get("speed"),
                record.get("eta"),
                record.get("filepath"),
                record.get("error"),
                record["created_at"],
                record["updated_at"],
            ),
        )


def list_downloads(status: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
    query = "SELECT * FROM downloads"
    params: list[Any] = []
    if status is not None:
        query += " WHERE status = ?"
        params.append(status)
    query += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)
    with connect() as conn:
        rows = conn.execute(query, params).fetchall()
    return [dict(row) for row in rows]


def get_download(record_id: str) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM downloads WHERE id = ?", (record_id,)).fetchone()
    return dict(row) if row else None


def update_download(record_id: str, **fields: Any) -> None:
    if not fields:
        return
    assignments = ", ".join(f"{key} = ?" for key in fields)
    params = list(fields.values()) + [record_id]
    with connect() as conn:
        conn.execute(f"UPDATE downloads SET {assignments} WHERE id = ?", params)


def delete_download(record_id: str) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM downloads WHERE id = ?", (record_id,))


def mark_interrupted() -> None:
    with connect() as conn:
        conn.execute(
            "UPDATE downloads SET status = 'failed', error = 'interrupted by restart', updated_at = datetime('now') WHERE status IN ('queued', 'downloading', 'processing')"
        )
