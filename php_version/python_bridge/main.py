import os
import asyncio
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from telethon import TelegramClient, events
from telethon.sessions import StringSession
import mysql.connector
from dotenv import load_dotenv
import shutil
import uuid
import traceback
import logging
import urllib.parse

# Load .env from current directory AND parent directory
load_dotenv(os.path.join(os.getcwd(), '.env'))
load_dotenv(os.path.join(os.path.dirname(os.getcwd()), '.env'))

import glob

def cleanup_orphaned_temps():
    try:
        orphaned_files = glob.glob("temp_upload_*.dat")
        for f in orphaned_files:
            print(f"CLEANUP: Removing orphaned temp file: {f}")
            os.remove(f)
    except Exception as e:
        print(f"CLEANUP ERROR: {e}")

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, replace with your specific domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Config
API_ID = int(os.getenv('TELEGRAM_API_ID', 0))
API_HASH = os.getenv('TELEGRAM_API_HASH', '')
# Only take the first token if there are multiple separated by comma
BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN', '').split(',')[0].strip()
CHAT_ID = os.getenv('TELEGRAM_CHAT_ID', '')
DB_CONFIG = {
    'host': os.getenv('DB_HOST', '127.0.0.1'),
    'port': int(os.getenv('DB_PORT', 3306)),
    'user': os.getenv('DB_USER', 'root'),
    'password': os.getenv('DB_PASS', ''),
    'database': os.getenv('DB_NAME', 'telegram_bot'),
    'charset': 'utf8mb4',
    'use_unicode': True
}

# we will store session string in the database for Render compatibility
def get_session_string():
    try:
        conn = mysql.connector.connect(**DB_CONFIG)
        cursor = conn.cursor()
        cursor.execute("CREATE TABLE IF NOT EXISTS system_config (config_key VARCHAR(255) PRIMARY KEY, config_value TEXT)")
        cursor.execute("SELECT config_value FROM system_config WHERE config_key = 'telethon_session'")
        row = cursor.fetchone()
        conn.close()
        return row[0] if row else None
    except Exception as e:
        print(f"DB Error: {e}")
        return None

def save_session_string(session_str):
    conn = mysql.connector.connect(**DB_CONFIG)
    cursor = conn.cursor()
    cursor.execute("REPLACE INTO system_config (config_key, config_value) VALUES ('telethon_session', %s)", (session_str,))
    conn.commit()
    conn.close()

# Initialize Client
session_string = get_session_string()
client = TelegramClient(StringSession(session_string), API_ID, API_HASH)

@app.on_event("startup")
async def startup():
    cleanup_orphaned_temps()
    try:
        await client.start(bot_token=BOT_TOKEN)
        new_session = client.session.save()
        if new_session != session_string:
            save_session_string(new_session)
        print("Telethon Bot Started Successfully")
    except Exception as e:
        print(f"Failed to start Telethon: {e}")
        print("WARNING: Python Bridge is running, but Telegram upload will fail until the Bot Token is fixed.")

@app.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    user_id: int = Form(...),
    chat_id: str = Form(CHAT_ID)
):
    temp_filename = f"temp_upload_{uuid.uuid4().hex}.dat"
    print(f"DEBUG: Received upload request for {file.filename} (Size: {file.size if hasattr(file, 'size') else 'unknown'})")
    
    try:
        print(f"DEBUG: Saving to temp file: {temp_filename}")
        with open(temp_filename, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        file_size = os.path.getsize(temp_filename)
        print(f"DEBUG: Temp file saved. Size: {file_size} bytes")

        # Upload via Telethon
        print(f"DEBUG: Starting Telethon upload to chat {chat_id}...")
        
        # Ensure chat_id is integer if possible, and remove any non-numeric chars if it's not a username
        target_chat = chat_id
        if isinstance(chat_id, str):
            if chat_id.startswith('-100'):
                try:
                     target_chat = int(chat_id)
                except:
                     pass
            elif chat_id.isdigit() or (chat_id.startswith('-') and chat_id[1:].isdigit()):
                try:
                    target_chat = int(chat_id)
                except:
                    pass
        
        print(f"DEBUG: Resolved target chat ID: {target_chat} (Type: {type(target_chat)})")

        def progress_callback(current, total):
            # Only log every 10% to avoid flooding
            if total > 0:
                pct = (current / total) * 100
                if int(pct) % 10 == 0 or current == total:
                    print(f"DEBUG: Upload progress: {pct:.1f}% ({current}/{total} bytes)")

        # Ensure client is connected (it should be from startup)
        if not client.is_connected():
            print("DEBUG: Client not connected, reconnecting...")
            await client.connect()

        sent_msg = await client.send_file(
            target_chat,
            temp_filename,
            caption=f"📁 {file.filename}\n👤 Yükleyen ID: {user_id}",
            force_document=True,
            progress_callback=progress_callback
        )
        
        print(f"DEBUG: Telethon upload complete. Message ID: {sent_msg.id if sent_msg else 'FAILED'}")

        # Log to Database
        if sent_msg and sent_msg.document:
            doc = sent_msg.document
            conn = mysql.connector.connect(**DB_CONFIG)
            cursor = conn.cursor()
            
            random_name = f"{uuid.uuid4().hex[:12]}.{file.filename.split('.')[-1]}"
            
            sql = """INSERT INTO files 
                     (telegram_file_id, telegram_message_id, file_name, display_name, file_size, file_type, mime_type, user_id) 
                     VALUES (%s, %s, %s, %s, %s, %s, %s, %s)"""
            
            cursor.execute(sql, (
                str(doc.id),
                sent_msg.id,
                file.filename,
                random_name,
                doc.size,
                file.content_type,
                file.content_type,
                user_id
            ))
            conn.commit()
            conn.close()

            return {"success": True, "message": "File uploaded via Telethon", "id": str(doc.id)}
        
        raise HTTPException(status_code=500, detail="Telethon upload failed")

    except Exception as e:
        error_msg = traceback.format_exc()
        print(f"ERROR: Upload failed:\n{error_msg}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if os.path.exists(temp_filename):
            print(f"DEBUG: Cleaning up temp file: {temp_filename}")
            os.remove(temp_filename)

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request

# ...

@app.get("/download/{file_id}/{filename}")
async def download_file(file_id: str, filename: str, request: Request, stream: bool = False):
    print(f"DEBUG: {'Stream' if stream else 'Download'} request for ID: {file_id}, Name: {filename}")
    
    try:
        # Ensure client is connected
        if not client.is_connected():
            print("DEBUG: Client not connected in download, reconnecting...")
            await client.connect()

        # Since we have the DB, let's look up the message_id
        conn = mysql.connector.connect(**DB_CONFIG)
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT telegram_message_id, mime_type, file_size FROM files WHERE telegram_file_id = %s", (file_id,))
        file_record = cursor.fetchone()
        conn.close()

        if not file_record or not file_record['telegram_message_id']:
            raise HTTPException(status_code=404, detail="File metadata not found in database")

        message_id = file_record['telegram_message_id']
        print(f"DEBUG: Found message ID {message_id} in database")

        msg = await client.get_messages(int(CHAT_ID) if CHAT_ID.isdigit() else CHAT_ID, ids=message_id)
        if not msg or not msg.document:
            raise HTTPException(status_code=404, detail="File not found on Telegram")

        doc = msg.document
        
        file_size = file_record['file_size']
        
        # Handle Range Header
        range_header = request.headers.get("Range")
        start = 0
        end = file_size - 1
        
        if range_header:
            try:
                # Parse Range: bytes=0- or bytes=100-200
                h = range_header.replace("bytes=", "").split("-")
                start = int(h[0]) if h[0] else 0
                end = int(h[1]) if len(h) > 1 and h[1] else file_size - 1
            except ValueError:
                pass
        
        # Validation
        if start >= file_size or end >= file_size:
            raise HTTPException(status_code=416, detail="Range Not Satisfiable")
            
        chunk_length = end - start + 1

        async def file_sender(offset, length):
            # Telethon iter_download allows offset and request_size/limit
            # We want to yield chunks.
            async for chunk in client.iter_download(doc, offset=offset, request_size=length, limit=length):
                yield chunk

        if stream:
            disposition = "inline"
            status_code = 206 if range_header else 200
        else:
            safe_filename = urllib.parse.quote(filename)
            disposition = f"attachment; filename*=UTF-8''{safe_filename}"
            status_code = 200
            start = 0
            end = file_size - 1
            chunk_length = file_size
        
        headers = {
            "Content-Disposition": disposition,
            "Content-Length": str(chunk_length),
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges": "bytes"
        }

        return StreamingResponse(
            file_sender(start, chunk_length),
            media_type=file_record['mime_type'] or 'application/octet-stream',
            headers=headers,
            status_code=status_code
        )

    except Exception as e:
        error_msg = traceback.format_exc()
        print(f"ERROR: Download failed:\n{error_msg}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health():
    return {"status": "online", "client_connected": client.is_connected()}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)
