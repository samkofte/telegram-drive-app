import asyncio
import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), 'src'))

from database import AsyncSessionLocal
from models import File as FileModel
from sqlalchemy import select

async def check_files():
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(FileModel))
        files = result.scalars().all()
        print('Veritabanındaki dosyalar:')
        for f in files:
            print(f'ID: {f.id}, telegram_file_id: {f.telegram_file_id}')
            print(f'  file_name: {f.file_name}')
            print(f'  display_name: {f.display_name}')
            print(f'  user_id: {f.user_id}')
            print(f'  file_size: {f.file_size}')
            print('---')

if __name__ == "__main__":
    asyncio.run(check_files())