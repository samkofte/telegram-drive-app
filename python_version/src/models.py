from sqlalchemy import Column, Integer, String, DateTime, Text, Boolean, BigInteger, ForeignKey, Enum
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from database import Base
from datetime import datetime
import enum
import uuid
import secrets
import string

class UserRole(enum.Enum):
    USER = "user"
    ADMIN = "admin"
    MODERATOR = "moderator"

def generate_random_filename(length=12):
    """Rastgele dosya ismi oluştur"""
    characters = string.ascii_letters + string.digits
    return ''.join(secrets.choice(characters) for _ in range(length))

class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    telegram_id = Column(BigInteger, unique=True, index=True, nullable=True)  # Made nullable for web users
    username = Column(String(255), nullable=True)
    email = Column(String(255), unique=True, index=True, nullable=True)  # For web authentication
    password_hash = Column(String(255), nullable=True)  # For web authentication
    first_name = Column(String(255), nullable=True)
    last_name = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True)
    role = Column(Enum(UserRole), default=UserRole.USER)  # User role system
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Relationship back reference
    files = relationship("File", back_populates="user")

class File(Base):
    __tablename__ = "files"
    
    id = Column(Integer, primary_key=True, index=True)
    telegram_file_id = Column(String(255), unique=True, index=True, nullable=False)
    file_name = Column(String(500), nullable=False)  # Original filename
    display_name = Column(String(500), nullable=True)  # Random display name
    file_size = Column(BigInteger, nullable=False)
    file_type = Column(String(100), nullable=True)
    mime_type = Column(String(255), nullable=True)
    file_path = Column(Text, nullable=True)  # Local file path if downloaded
    telegram_url = Column(Text, nullable=True)  # Telegram file URL
    uploaded_by = Column(BigInteger, nullable=True)  # Telegram user ID
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)  # Web user ID
    
    # Relationship
    user = relationship("User", back_populates="files")
    is_downloaded = Column(Boolean, default=False)
    download_count = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

class DownloadLog(Base):
    __tablename__ = "download_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    file_id = Column(Integer, nullable=False)  # Reference to File.id
    user_telegram_id = Column(BigInteger, nullable=False)
    download_time = Column(DateTime(timezone=True), server_default=func.now())
    ip_address = Column(String(45), nullable=True)  # IPv4 or IPv6
    user_agent = Column(Text, nullable=True)

class ApiKey(Base):
    __tablename__ = "api_keys"
    
    id = Column(Integer, primary_key=True, index=True)
    key_name = Column(String(255), nullable=False)
    api_key = Column(String(255), unique=True, index=True, nullable=False)
    user_telegram_id = Column(BigInteger, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_used = Column(DateTime(timezone=True), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)