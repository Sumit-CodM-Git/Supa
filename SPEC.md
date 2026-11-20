# YouTube Downloader Specification

This project implements a local-only YouTube downloader with a FastAPI backend and a Vite + React frontend.

## Scope
- Support paste of a YouTube video URL, playlist URL, or Shorts URL.
- Show available formats: video, audio, and combined.
- Allow users to queue downloads with concurrency limits.
- Keep download history in SQLite.
- Persist configuration in JSON.
- Bind the application to 127.0.0.1.

## Core requirements
- Python 3.10+
- FastAPI + Uvicorn
- yt-dlp + ffmpeg + ffprobe on PATH
- sqlite3 via stdlib
- Vite + React + TypeScript + Tailwind CSS v3
- @tanstack/react-query

## Files
- `backend/main.py`
- `backend/config.py`
- `backend/db.py`
- `backend/models.py`
- `backend/errors.py`
- `backend/routes/*`
- `backend/services/*`
- `frontend/src/*`

## Acceptance notes
The implementation should follow the API and file structure described in the product spec and must validate without hitting the network during tests.
