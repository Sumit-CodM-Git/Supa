from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class InspectRequest(BaseModel):
    url: str


class DownloadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str
    kind: Literal["video", "audio", "combined"]
    format_id: str
    container: str | None = None
    audio_format: Literal["mp3", "m4a", "opus"] | None = None
    audio_bitrate: Literal[128, 192, 256, 320] = 192
    write_subtitles: bool = False
    subtitle_langs: list[str] | None = None
    embed_thumbnail: bool = False
    embed_metadata: bool = True


class ClipRange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start: float = Field(ge=0, allow_inf_nan=False)
    end: float = Field(gt=0, allow_inf_nan=False)

    @model_validator(mode="after")
    def ordered(self) -> "ClipRange":
        if self.end <= self.start:
            raise ValueError("Clip end must be after its start")
        return self


class CaptionCue(ClipRange):
    text: str = Field(max_length=2000)


class TranscriptRequest(InspectRequest):
    language: str | None = Field(default=None, max_length=100)


class ClipsRequest(DownloadRequest):
    ranges: list[ClipRange] = Field(min_length=1, max_length=50)
    auto_portrait: bool = False
    show_captions: bool = False
    captions: list[CaptionCue] = Field(default_factory=list, max_length=10000)


class CaptionStyle(BaseModel):
    model_config = ConfigDict(extra="forbid")
    font: Literal["Arial", "Helvetica", "Georgia", "Verdana", "Courier New", "Times New Roman"] = "Arial"
    size: int = Field(default=22, ge=12, le=48)
    color: str = Field(default="#FFFFFF", pattern=r"^#[0-9A-Fa-f]{6}$")
    outline_color: str = Field(default="#000000", pattern=r"^#[0-9A-Fa-f]{6}$")
    background_color: str = Field(default="#000000", pattern=r"^#[0-9A-Fa-f]{6}$")
    background: bool = False
    bold: bool = True
    italic: bool = False
    position: Literal["top", "middle", "bottom"] = "bottom"
    align: Literal["left", "center", "right"] = "center"
    margin: int = Field(default=24, ge=0, le=80)
    outline: int = Field(default=2, ge=0, le=5)
    shadow: int = Field(default=0, ge=0, le=5)


class SettingsConfig(BaseModel):
    default_caption_language: str = Field(default="original", pattern=r"^(original|[a-z]{2,3}(-[A-Za-z0-9]{2,8})*)$")
    captions_enabled: bool = False
    auto_portrait: bool = False
    caption_style: CaptionStyle = Field(default_factory=CaptionStyle)
    download_dir: str = Field(default="./downloads", min_length=1)
    max_concurrent: int = Field(default=2, ge=1, le=8)
    cookiefile: str | None = None
    cookies_from_browser: str | None = None
    proxy: str | None = None
    player_clients: list[str] = Field(default_factory=list)
    default_container: str = "mp4"
    prefer_mp4: bool = True
    subtitle_langs: list[str] = ["en"]
    keep_original: bool = False
    filename_template: str = "%(title).150B [%(id)s].%(ext)s"


class HealthResponse(BaseModel):
    ok: bool
    ffmpeg: bool
    yt_dlp_version: str
    download_dir_writable: bool


class ErrorsResponse(BaseModel):
    error: dict[str, str]
