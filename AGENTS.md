# AGENTS.md

Implementation order:
1. Create the FastAPI skeleton, config, database initialization, and health endpoint.
2. Implement the format builder and format inference logic with unit tests.
3. Add the inspect API and playlist handling.
4. Implement download orchestration and cancellation logic.
5. Add settings persistence and configuration validation.
6. Build the frontend shell, format table, downloads panel, and history UI.
7. Finish polish: error mapping, empty states, and README/run script.

Rules:
- No placeholders or TODOs.
- Use the pinned dependency list.
- Bind to 127.0.0.1.
- Keep all file access through the safe-path helper.
- Never accept raw yt-dlp selectors from the client.
- No auth, no cloud deployment, no ORM, no Docker.
- Keep all tests offline and deterministic.
