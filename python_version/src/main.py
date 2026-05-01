import os
import asyncio
import math
from datetime import datetime, timedelta
from typing import List, Optional
from pathlib import Path

from fastapi import FastAPI, File, UploadFile, HTTPException, Form, Request, Response, Depends, status
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import uvicorn
import telegram
from pydantic import BaseModel, EmailStr
import mimetypes
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from passlib.context import CryptContext
from jose import JWTError, jwt

# Database imports
from database import get_db, create_tables, close_db
from models import User, File as FileModel, DownloadLog, ApiKey, UserRole, generate_random_filename

# Configuration loaded directly

# JWT Configuration
SECRET_KEY = "your-secret-key-here-change-in-production"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()

app = FastAPI(title="Telegram File Manager API", version="1.0.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
TELEGRAM_BOT_TOKEN = "7674057900:AAFhhQq9j5gLR0UeEg_XLECHCmyAdzskqto"
TELEGRAM_CHAT_ID = "710553403"
MAX_FILE_SIZE = 104857600  # 100MB

# Initialize Telegram bot
bot = None
if TELEGRAM_BOT_TOKEN:
    bot = telegram.Bot(token=TELEGRAM_BOT_TOKEN)

# Pydantic models
class FileInfo(BaseModel):
    filename: str
    file_id: str
    file_size: int
    mime_type: str
    upload_date: str
    telegram_message_id: Optional[int] = None

class UploadResponse(BaseModel):
    success: bool
    message: str
    file_info: Optional[FileInfo] = None

# Authentication Models
class UserRegister(BaseModel):
    email: EmailStr
    password: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str

class UserResponse(BaseModel):
    id: int
    email: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    is_active: bool
    role: str
    created_at: datetime

# Authentication Helper Functions
def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security), db: AsyncSession = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user is None:
        raise credentials_exception
    return user

async def get_current_active_user(current_user: User = Depends(get_current_user)):
    if not current_user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return current_user

async def get_admin_user(current_user: User = Depends(get_current_active_user)):
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required"
        )
    return current_user

# Store uploaded files info (in production, use a database)
uploaded_files: List[FileInfo] = []

# Authentication Endpoints
@app.post("/auth/register", response_model=UserResponse)
async def register_user(user_data: UserRegister, db: AsyncSession = Depends(get_db)):
    # Check if user already exists
    result = await db.execute(select(User).where(User.email == user_data.email))
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    # Create new user
    hashed_password = get_password_hash(user_data.password)
    new_user = User(
        email=user_data.email,
        password_hash=hashed_password,
        first_name=user_data.first_name,
        last_name=user_data.last_name,
        is_active=True,
        role=UserRole.USER  # Default role
    )
    
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    
    return UserResponse(
        id=new_user.id,
        email=new_user.email,
        first_name=new_user.first_name,
        last_name=new_user.last_name,
        is_active=new_user.is_active,
        role=new_user.role.value,
        created_at=new_user.created_at
    )

@app.post("/auth/login", response_model=Token)
async def login_user(user_data: UserLogin, db: AsyncSession = Depends(get_db)):
    # Find user by email
    result = await db.execute(select(User).where(User.email == user_data.email))
    user = result.scalar_one_or_none()
    
    if not user or not verify_password(user_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user"
        )
    
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/auth/me", response_model=UserResponse)
async def read_users_me(current_user: User = Depends(get_current_active_user)):
    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        first_name=current_user.first_name,
        last_name=current_user.last_name,
        is_active=current_user.is_active,
        role=current_user.role.value,
        created_at=current_user.created_at
    )

@app.get("/", response_class=HTMLResponse)
async def read_root():
    """Ana sayfa - Web arayüzü"""
    return FileResponse("templates/index.html", media_type="text/html")

@app.get("/login", response_class=HTMLResponse)
async def login_page():
    return FileResponse("templates/login.html")

@app.get("/register", response_class=HTMLResponse)
async def register_page():
    return FileResponse("templates/register.html")

@app.get("/player/{file_id}", response_class=HTMLResponse)
async def video_player_page(file_id: str):
    """Video oynatıcı sayfası"""
    # Find file info
    file_info = None
    for file in uploaded_files:
        if file.file_id == file_id:
            file_info = file
            break
    
    if not file_info:
        raise HTTPException(status_code=404, detail="Dosya bulunamadı")
    
    if not file_info.mime_type.startswith('video/'):
        raise HTTPException(status_code=400, detail="Bu dosya video değil")
    
    # Return the static HTML file - JavaScript will handle the video URL
    return FileResponse("templates/video_player.html", media_type="text/html")

def format_file_size(bytes):
    """Dosya boyutunu formatla"""
    if bytes == 0:
        return '0 Bytes'
    k = 1024
    sizes = ['Bytes', 'KB', 'MB', 'GB']
    i = int(math.floor(math.log(bytes) / math.log(k)))
    return f"{round(bytes / math.pow(k, i), 2)} {sizes[i]}"

@app.post("/upload", response_model=UploadResponse)
async def upload_file(file: UploadFile = File(...), current_user: User = Depends(get_current_active_user), db: AsyncSession = Depends(get_db)):
    """Dosya yükleme endpoint'i"""
    if not bot:
        raise HTTPException(status_code=500, detail="Telegram bot yapılandırılmamış")
    
    if not TELEGRAM_CHAT_ID:
        raise HTTPException(status_code=500, detail="Telegram chat ID yapılandırılmamış")
    
    # Check file size
    if file.size and file.size > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail=f"Dosya boyutu çok büyük. Maksimum: {MAX_FILE_SIZE} bytes")
    
    try:
        # Read file content directly from memory
        content = await file.read()
        
        # Send to Telegram using BytesIO
        from io import BytesIO
        file_buffer = BytesIO(content)
        file_buffer.name = file.filename
        
        message = await bot.send_document(
            chat_id=TELEGRAM_CHAT_ID,
            document=file_buffer,
            caption=f"📁 {file.filename}\n📅 {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
        )
        
        # Get file info from Telegram
        if message.document:
            file_info = FileInfo(
                filename=file.filename,
                file_id=message.document.file_id,
                file_size=message.document.file_size or 0,
                mime_type=message.document.mime_type or "application/octet-stream",
                upload_date=datetime.now().isoformat(),
                telegram_message_id=message.message_id
            )
        else:
            file_info = FileInfo(
                filename=file.filename,
                file_id=str(message.message_id),
                file_size=file.size or 0,
                mime_type=file.content_type or "application/octet-stream",
                upload_date=datetime.now().isoformat(),
                telegram_message_id=message.message_id
            )
        
        # Generate random display name to prevent conflicts
        file_extension = Path(file.filename).suffix if file.filename else ""
        random_display_name = generate_random_filename() + file_extension
        
        # Store file info in database
        db_file = FileModel(
            telegram_file_id=file_info.file_id,
            file_name=file_info.filename,  # Original filename
            display_name=random_display_name,  # Random display name
            file_size=file_info.file_size,
            file_type=file.content_type or "application/octet-stream",
            mime_type=file_info.mime_type,
            uploaded_by=None,  # Telegram user ID (not used for web users)
            user_id=current_user.id,  # Web user ID
            is_downloaded=False
        )
        
        db.add(db_file)
        await db.commit()
        await db.refresh(db_file)
        
        # Also keep in memory for backward compatibility
        uploaded_files.append(file_info)
        
        return UploadResponse(
            success=True,
            message=f"{file.filename} başarıyla yüklendi",
            file_info=file_info
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Dosya yüklenirken hata: {str(e)}")

@app.get("/files", response_model=List[FileInfo])
async def list_files(current_user: User = Depends(get_current_active_user), db: AsyncSession = Depends(get_db)):
    """Yüklenen dosyaları listele"""
    # Veritabanından dosyaları çek - user_id kullan
    result = await db.execute(select(FileModel).where(FileModel.user_id == current_user.id).order_by(FileModel.created_at.desc()))
    db_files = result.scalars().all()
    
    # FileInfo formatına dönüştür
    file_list = []
    for db_file in db_files:
        file_info = FileInfo(
            filename=db_file.display_name or db_file.file_name,  # Display random name
            file_id=db_file.telegram_file_id,
            file_size=db_file.file_size,
            mime_type=db_file.mime_type or "application/octet-stream",
            upload_date=db_file.created_at.isoformat() if db_file.created_at else datetime.now().isoformat(),
            telegram_message_id=None
        )
        file_list.append(file_info)
    
    return file_list

@app.get("/stream/{file_id}")
async def stream_video(file_id: str, request: Request, current_user: User = Depends(get_current_active_user), db: AsyncSession = Depends(get_db)):
    """Video streaming endpoint'i - Range request desteği ile"""
    # Find file info in database - only user's own files
    result = await db.execute(select(FileModel).where(
        FileModel.telegram_file_id == file_id,
        FileModel.user_id == current_user.id
    ))
    db_file = result.scalar_one_or_none()
    
    if not db_file:
        raise HTTPException(status_code=404, detail="Dosya bulunamadı veya erişim yetkiniz yok")
    
    # Check if it's a video file
    if not db_file.mime_type.startswith('video/'):
        raise HTTPException(status_code=400, detail="Bu dosya video değil")
    
    try:
        # Get file from Telegram
        if not bot:
            raise HTTPException(status_code=500, detail="Telegram bot yapılandırılmamış")
        
        file = await bot.get_file(file_id)
        
        # Check if file_path already contains the full URL
        if file.file_path.startswith('https://'):
            download_url = file.file_path
        else:
            download_url = f"https://api.telegram.org/file/bot{TELEGRAM_BOT_TOKEN}/{file.file_path}"
        
        print(f"File path: {file.file_path}")  # Debug için
        print(f"Stream URL: {download_url}")  # Debug için
        
        # Redirect to Telegram URL for streaming
        return Response(
            status_code=302,
            headers={"Location": download_url}
        )
        
    except Exception as e:
        print(f"Stream error: {str(e)}")  # Debug için
        raise HTTPException(status_code=500, detail=f"Video stream hatası: {str(e)}")

@app.get("/telegram-url/{file_id}")
async def get_telegram_url(file_id: str, current_user: User = Depends(get_current_active_user), db: AsyncSession = Depends(get_db)):
    """Telegram dosya URL'ini JSON olarak döndür"""
    # Find file info in database - only user's own files
    result = await db.execute(select(FileModel).where(
        FileModel.telegram_file_id == file_id,
        FileModel.user_id == current_user.id
    ))
    db_file = result.scalar_one_or_none()
    
    if not db_file:
        return JSONResponse(
            status_code=404,
            content={"success": False, "message": "Dosya bulunamadı veya erişim yetkiniz yok"}
        )
    
    try:
        # Get file from Telegram
        if not bot:
            return JSONResponse(
                status_code=500,
                content={"success": False, "message": "Telegram bot yapılandırılmamış"}
            )
        
        file = await bot.get_file(file_id)
        
        # Check if file_path already contains the full URL
        if file.file_path.startswith('https://'):
            download_url = file.file_path
        else:
            download_url = f"https://api.telegram.org/file/bot{TELEGRAM_BOT_TOKEN}/{file.file_path}"
        
        print(f"File path: {file.file_path}")  # Debug için
        print(f"Telegram URL: {download_url}")  # Debug için
        
        return {
            "success": True,
            "download_url": download_url,
            "filename": db_file.file_name,
            "file_size": db_file.file_size,
            "mime_type": db_file.mime_type
        }
        
    except Exception as e:
        print(f"Telegram URL error: {str(e)}")  # Debug için
        return JSONResponse(
            status_code=500,
            content={"success": False, "message": f"Telegram URL alınırken hata: {str(e)}"}
        )

@app.get("/download/{file_id}")
async def download_file(file_id: str, request: Request, current_user: User = Depends(get_current_active_user), db: AsyncSession = Depends(get_db)):
    """Dosya indirme endpoint'i - Doğrudan dosya indirme"""
    # Find file info in database - only user's own files
    result = await db.execute(select(FileModel).where(
        FileModel.telegram_file_id == file_id,
        FileModel.user_id == current_user.id
    ))
    db_file = result.scalar_one_or_none()
    
    if not db_file:
        raise HTTPException(status_code=404, detail="Dosya bulunamadı veya erişim yetkiniz yok")
    
    try:
        # Get file from Telegram
        if not bot:
            raise HTTPException(status_code=500, detail="Telegram bot yapılandırılmamış")
        
        file = await bot.get_file(file_id)
        
        # Check if file_path already contains the full URL
        if file.file_path.startswith('https://'):
            download_url = file.file_path
        else:
            download_url = f"https://api.telegram.org/file/bot{TELEGRAM_BOT_TOKEN}/{file.file_path}"
        
        # Download log'u kaydet
        download_log = DownloadLog(
            file_id=db_file.id,
            user_telegram_id=int(TELEGRAM_CHAT_ID),
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent")
        )
        db.add(download_log)
        
        # Download count'u artır
        db_file.download_count += 1
        await db.commit()
        
        # Redirect to Telegram download URL
        return Response(
            status_code=302,
            headers={
                "Location": download_url,
                "Content-Disposition": f"attachment; filename=\"{db_file.file_name}\""
            }
        )
        
    except Exception as e:
        print(f"Download error: {str(e)}")  # Debug için
        raise HTTPException(status_code=500, detail=f"Dosya indirilirken hata: {str(e)}")

@app.delete("/files/{file_id}")
async def delete_file(file_id: str, current_user: User = Depends(get_current_active_user), db: AsyncSession = Depends(get_db)):
    """Dosya silme endpoint'i"""
    if not bot:
        raise HTTPException(status_code=500, detail="Telegram bot yapılandırılmamış")
    
    # Find file info in database - only user's own files
    result = await db.execute(select(FileModel).where(
        FileModel.telegram_file_id == file_id,
        FileModel.user_id == current_user.id
    ))
    db_file = result.scalar_one_or_none()
    
    if not db_file:
        raise HTTPException(status_code=404, detail="Dosya bulunamadı veya erişim yetkiniz yok")
    
    try:
        # Delete from database first
        await db.delete(db_file)
        await db.commit()
        
        # Remove from local list for backward compatibility
        file_index = -1
        for i, file in enumerate(uploaded_files):
            if file.file_id == file_id:
                file_index = i
                break
        
        if file_index >= 0:
            uploaded_files.pop(file_index)
        
        return {"success": True, "message": "Dosya başarıyla silindi"}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Dosya silinirken hata: {str(e)}")

# Admin Panel Endpoints
@app.get("/admin/users", response_model=List[UserResponse])
async def admin_list_users(admin_user: User = Depends(get_admin_user), db: AsyncSession = Depends(get_db)):
    """Admin: Tüm kullanıcıları listele"""
    result = await db.execute(select(User).order_by(User.created_at.desc()))
    users = result.scalars().all()
    
    return [
        UserResponse(
            id=user.id,
            email=user.email,
            first_name=user.first_name,
            last_name=user.last_name,
            is_active=user.is_active,
            role=user.role.value,
            created_at=user.created_at
        )
        for user in users
    ]

@app.get("/admin/files")
async def admin_list_all_files(admin_user: User = Depends(get_admin_user), db: AsyncSession = Depends(get_db)):
    """Admin: Tüm dosyaları listele"""
    result = await db.execute(select(FileModel).order_by(FileModel.created_at.desc()))
    files = result.scalars().all()
    
    file_list = []
    for db_file in files:
        # Get user info
        user_result = await db.execute(select(User).where(User.id == db_file.user_id))
        user = user_result.scalar_one_or_none()
        
        file_info = {
            "id": db_file.id,
            "filename": db_file.file_name,
            "display_name": db_file.display_name,
            "file_id": db_file.telegram_file_id,
            "file_size": db_file.file_size,
            "mime_type": db_file.mime_type,
            "upload_date": db_file.created_at.isoformat() if db_file.created_at else None,
            "user_email": user.email if user else "Unknown",
            "user_id": db_file.user_id
        }
        file_list.append(file_info)
    
    return {"files": file_list, "total": len(file_list)}

@app.put("/admin/users/{user_id}/role")
async def admin_update_user_role(user_id: int, role: str, admin_user: User = Depends(get_admin_user), db: AsyncSession = Depends(get_db)):
    """Admin: Kullanıcı rolünü güncelle"""
    # Validate role
    try:
        new_role = UserRole(role)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid role")
    
    # Get user
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Update role
    user.role = new_role
    await db.commit()
    
    return {"message": f"User role updated to {role}", "user_id": user_id}

@app.delete("/admin/files/{file_id}")
async def admin_delete_file(file_id: str, admin_user: User = Depends(get_admin_user), db: AsyncSession = Depends(get_db)):
    """Admin: Herhangi bir dosyayı sil"""
    # Find file in database
    result = await db.execute(select(FileModel).where(FileModel.telegram_file_id == file_id))
    db_file = result.scalar_one_or_none()
    
    if not db_file:
        raise HTTPException(status_code=404, detail="File not found")
    
    # Delete from database
    await db.delete(db_file)
    await db.commit()
    
    return {"message": "File deleted successfully by admin", "file_id": file_id}

@app.get("/health")
async def health_check():
    """Sağlık kontrolü endpoint'i"""
    return {
        "status": "healthy",
        "bot_configured": bot is not None,
        "chat_id_configured": TELEGRAM_CHAT_ID is not None,
        "uploaded_files_count": len(uploaded_files)
    }

@app.on_event("startup")
async def startup_event():
    """Uygulama başlatıldığında veritabanı tablolarını oluştur"""
    await create_tables()
    print("Veritabanı tabloları oluşturuldu")

@app.on_event("shutdown")
async def shutdown_event():
    """Uygulama kapatıldığında veritabanı bağlantısını kapat"""
    await close_db()
    print("Veritabanı bağlantısı kapatıldı")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)