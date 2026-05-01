import os
import shutil
import tempfile
import traceback
import urllib.parse
import uuid
from datetime import datetime

import aiohttp
import mysql.connector
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

load_dotenv(os.path.join(os.getcwd(), ".env"))
load_dotenv(os.path.join(os.path.dirname(os.getcwd()), ".env"))

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")
BOT_UPLOAD_LIMIT = int(os.getenv("TELEGRAM_BOT_UPLOAD_LIMIT", 45 * 1024 * 1024))
DB_CONFIG = {
    "host": os.getenv("DB_HOST", "127.0.0.1"),
    "port": int(os.getenv("DB_PORT", 3306)),
    "user": os.getenv("DB_USER", "root"),
    "password": os.getenv("DB_PASS", ""),
    "database": os.getenv("DB_NAME", "telegram"),
    "charset": "utf8mb4",
    "use_unicode": True,
}

_next_bot_index = 0


def get_bot_tokens() -> list[str]:
    return [token.strip() for token in os.getenv("TELEGRAM_BOT_TOKEN", "").split(",") if token.strip()]


def get_next_bot_token(tokens: list[str]) -> str:
    global _next_bot_index
    if not tokens:
        raise HTTPException(status_code=500, detail="No Telegram bot tokens configured")

    token = tokens[_next_bot_index % len(tokens)]
    _next_bot_index += 1
    return token


def get_user_context(user_id: int) -> dict:
    connection = get_db_connection()
    try:
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            "SELECT id, first_name, last_name, username, email FROM users WHERE id = %s LIMIT 1",
            (user_id,),
        )
        return cursor.fetchone() or {"id": user_id}
    finally:
        connection.close()


def build_caption(user: dict, filename: str) -> str:
    first_name = (user or {}).get("first_name") or ""
    last_name = (user or {}).get("last_name") or ""
    full_name = f"{first_name} {last_name}".strip() or "-"

    caption = f"📁 Dosya: {filename}\n"
    caption += f"🆔 ID: {(user or {}).get('id', '-')}\n"
    caption += f"👤 İsim: {full_name}\n"

    username = (user or {}).get("username")
    if username:
        caption += f"🏷️ Kullanıcı Adı: @{username}\n"

    caption += f"📧 Email: {(user or {}).get('email') or '-'}\n"
    caption += f"📅 Tarih: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
    return caption


def normalize_upload_filename(input_name: str | None, mime_type: str | None = None) -> str:
    candidate = (input_name or "").strip() or "upload.bin"
    candidate = urllib.parse.unquote(candidate)
    candidate = os.path.basename(candidate.replace("\\", "/")).strip(" .")
    if not candidate:
        candidate = "upload.bin"

    _, extension = os.path.splitext(candidate)
    if not extension and mime_type:
        guessed_extension = {
            "image/jpeg": ".jpg",
            "image/png": ".png",
            "image/webp": ".webp",
            "image/heic": ".heic",
            "image/heif": ".heif",
            "video/mp4": ".mp4",
            "video/quicktime": ".mov",
            "application/pdf": ".pdf",
        }.get(mime_type.lower(), "")
        if guessed_extension:
            candidate = f"{candidate}{guessed_extension}"

    return candidate


def build_stored_display_name(source_name: str) -> str:
    _, extension = os.path.splitext(source_name)
    return f"file_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}{extension.lower()}"


def build_chunk_filename(original_name: str, part_number: int, part_count: int) -> str:
    base, extension = os.path.splitext(original_name or "upload.bin")
    safe_base = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in (base or "file"))
    return f"{safe_base}.part{part_number:03d}of{part_count:03d}{extension}"


def build_chunk_master_file_id() -> str:
    return f"chunked_{uuid.uuid4().hex}"


async def send_document(token: str, chat_id: str, file_path: str, filename: str, caption: str) -> dict:
    url = f"https://api.telegram.org/bot{token}/sendDocument"
    form = aiohttp.FormData()
    form.add_field("chat_id", str(chat_id))
    form.add_field("caption", caption)
    with open(file_path, "rb") as file_handle:
        form.add_field("document", file_handle, filename=filename, content_type="application/octet-stream")
        async with aiohttp.ClientSession() as session:
            async with session.post(url, data=form) as response:
                payload = await response.json()
                if response.status >= 400 or not payload.get("ok"):
                    raise HTTPException(status_code=500, detail=payload.get("description", "Telegram upload failed"))
                payload["used_token"] = token
                return payload


async def resolve_telegram_url(token: str, file_id: str) -> str | None:
    url = f"https://api.telegram.org/bot{token}/getFile"
    async with aiohttp.ClientSession() as session:
        async with session.get(url, params={"file_id": file_id}) as response:
            payload = await response.json()
            if response.status >= 400 or not payload.get("ok"):
                return None
            file_path = payload.get("result", {}).get("file_path")
            if not file_path:
                return None
            return f"https://api.telegram.org/file/bot{token}/{file_path}"


def extract_media(payload: dict) -> dict:
    message = payload.get("result", {})
    media = message.get("document") or message.get("video")
    if not media and isinstance(message.get("photo"), list) and message["photo"]:
        media = message["photo"][-1]
        media["mime_type"] = media.get("mime_type") or "image/jpeg"
    if not media or not media.get("file_id"):
        raise HTTPException(status_code=500, detail="Telegram response does not include file metadata")
    return {
        "file_id": media["file_id"],
        "message_id": message.get("message_id"),
        "file_size": int(media.get("file_size", 0)),
        "mime_type": media.get("mime_type"),
    }


async def upload_via_python_engine(file_path: str, original_name: str, mime_type: str, user_id: int, chat_id: str) -> dict:
    file_size = os.path.getsize(file_path)
    if file_size <= 0:
        raise HTTPException(status_code=400, detail="Empty files cannot be uploaded")

    original_name = normalize_upload_filename(original_name, mime_type)
    stored_display_name = build_stored_display_name(original_name)
    tokens = get_bot_tokens()
    if not tokens:
        raise HTTPException(status_code=500, detail="No Telegram bot tokens configured")

    user_context = get_user_context(user_id)
    caption = build_caption(user_context, stored_display_name)
    if file_size <= BOT_UPLOAD_LIMIT:
        token = get_next_bot_token(tokens)
        result = await send_document(token, chat_id, file_path, stored_display_name, caption)
        media = extract_media(result)
        used_token = result.get("used_token")
        return {
            "telegram_file_id": media["file_id"],
            "telegram_message_id": media["message_id"],
            "file_name": original_name,
            "display_name": stored_display_name,
            "file_size": media["file_size"] or file_size,
            "mime_type": media["mime_type"] or mime_type,
            "bot_token": used_token,
            "telegram_url": await resolve_telegram_url(used_token, media["file_id"]) if used_token else None,
            "upload_engine": "python",
            "is_chunked": False,
            "chunk_count": 1,
            "parts": [],
        }

    part_count = (file_size + BOT_UPLOAD_LIMIT - 1) // BOT_UPLOAD_LIMIT
    parts: list[dict] = []
    bytes_remaining = file_size

    with open(file_path, "rb") as source:
        for index in range(part_count):
            current_size = min(BOT_UPLOAD_LIMIT, bytes_remaining)
            chunk_file = tempfile.NamedTemporaryFile(delete=False, suffix=".part")
            chunk_path = chunk_file.name
            try:
                written = 0
                while written < current_size:
                    buffer = source.read(min(1024 * 1024, current_size - written))
                    if not buffer:
                        break
                    chunk_file.write(buffer)
                    written += len(buffer)
                chunk_file.close()

                if written != current_size:
                    raise HTTPException(status_code=500, detail="Chunk file could not be generated correctly")

                token = tokens[index % len(tokens)]
                chunk_name = build_chunk_filename(stored_display_name, index + 1, part_count)
                result = await send_document(token, chat_id, chunk_path, chunk_name, f"{caption}\n📦 Parça: {index + 1}/{part_count}")
                media = extract_media(result)
                used_token = result.get("used_token", token)
                parts.append(
                    {
                        "part_index": index,
                        "telegram_file_id": media["file_id"],
                        "telegram_message_id": media["message_id"],
                        "part_name": chunk_name,
                        "part_size": written,
                        "mime_type": mime_type,
                        "bot_token": used_token,
                        "telegram_url": None,
                    }
                )
                bytes_remaining -= written
            finally:
                try:
                    chunk_file.close()
                except Exception:
                    pass
                if os.path.exists(chunk_path):
                    os.remove(chunk_path)

    return {
        "telegram_file_id": build_chunk_master_file_id(),
        "telegram_message_id": None,
        "file_name": original_name,
        "display_name": stored_display_name,
        "file_size": file_size,
        "mime_type": mime_type,
        "bot_token": None,
        "telegram_url": None,
        "upload_engine": "python",
        "is_chunked": True,
        "chunk_count": part_count,
        "parts": parts,
    }


def get_db_connection():
    return mysql.connector.connect(**DB_CONFIG)


async def stream_from_url(url: str):
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as response:
            if response.status >= 400:
                raise HTTPException(status_code=502, detail="Telegram file stream could not be opened")
            async for chunk in response.content.iter_chunked(1024 * 1024):
                yield chunk


async def get_file_url_from_bot(token: str | None, file_id: str) -> str:
    if not token:
        raise HTTPException(status_code=500, detail="Bot token not found for file")
    url = await resolve_telegram_url(token, file_id)
    if not url:
        raise HTTPException(status_code=404, detail="Telegram file path not found")
    return url


@app.post("/upload")
async def upload_file(file: UploadFile = File(...), user_id: int = Form(...), chat_id: str = Form(CHAT_ID)):
    suffix = os.path.splitext(file.filename or "upload.bin")[1]
    temp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix or ".bin")
    temp_path = temp.name

    try:
        with temp:
            shutil.copyfileobj(file.file, temp)

        payload = await upload_via_python_engine(
            temp_path,
            file.filename or "upload.bin",
            file.content_type or "application/octet-stream",
            user_id,
            chat_id,
        )
        return {"success": True, "file": payload}
    except HTTPException:
        raise
    except Exception as exc:
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


@app.get("/download/{file_id}/{filename}")
async def download_file(file_id: str, filename: str, request: Request, stream: bool = False):
    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)
        cursor.execute(
            "SELECT id, telegram_file_id, file_name, mime_type, file_size, bot_token, is_chunked FROM files WHERE telegram_file_id = %s LIMIT 1",
            (file_id,),
        )
        file_record = cursor.fetchone()
        if not file_record:
            raise HTTPException(status_code=404, detail="File metadata not found")

        mime_type = file_record.get("mime_type") or "application/octet-stream"
        file_size = int(file_record.get("file_size") or 0)
        safe_filename = urllib.parse.quote(filename or file_record.get("file_name") or "download.bin")
        disposition = "inline" if stream else f"attachment; filename*=UTF-8''{safe_filename}"

        if file_record.get("is_chunked"):
            cursor.execute(
                "SELECT telegram_file_id, bot_token FROM file_parts WHERE file_id = %s ORDER BY part_index ASC",
                (file_record["id"],),
            )
            parts = cursor.fetchall()
            if not parts:
                raise HTTPException(status_code=404, detail="Chunk metadata not found")

            async def chunk_sender():
                for part in parts:
                    url = await get_file_url_from_bot(part.get("bot_token"), part["telegram_file_id"])
                    async for chunk in stream_from_url(url):
                        yield chunk

            headers = {
                "Content-Disposition": disposition,
                "Content-Length": str(file_size),
                "Accept-Ranges": "none",
            }
            return StreamingResponse(chunk_sender(), media_type=mime_type, headers=headers, status_code=200)

        url = await get_file_url_from_bot(file_record.get("bot_token"), file_record["telegram_file_id"])
        headers = {
            "Content-Disposition": disposition,
            "Content-Length": str(file_size),
            "Accept-Ranges": "none",
        }
        return StreamingResponse(stream_from_url(url), media_type=mime_type, headers=headers, status_code=200)
    except HTTPException:
        raise
    except Exception as exc:
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        try:
            cursor.close()
            connection.close()
        except Exception:
            pass


@app.get("/health")
async def health():
    return {"status": "online", "engine": "python-bot-api"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8002)
