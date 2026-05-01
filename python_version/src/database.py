from sqlalchemy import create_engine, Column, Integer, String, DateTime, Text, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from datetime import datetime
import os

# Veritabanı URL'si
DATABASE_URL = "sqlite+aiosqlite:///./telegram_bot.db"

# Async engine oluştur
engine = create_async_engine(DATABASE_URL, echo=True, future=True)

# Session maker
AsyncSessionLocal = sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)

# Base model
Base = declarative_base()

# Veritabanı bağlantısı dependency
async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()

# Veritabanı tablolarını oluştur
async def create_tables():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

# Veritabanı bağlantısını kapat
async def close_db():
    await engine.dispose()