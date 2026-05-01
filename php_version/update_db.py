import sqlite3
import os

db_path = 'telegram_bot.db'

if not os.path.exists(db_path):
    print(f"Error: Database file '{db_path}' not found.")
    exit(1)

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

print("Starting database schema update...")

# 1. Create 'folders' table
try:
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        parent_id INTEGER DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted_at DATETIME DEFAULT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE
    )
    """)
    print("Table 'folders' checked/created.")
except sqlite3.Error as e:
    print(f"Error creating 'folders': {e}")

# 2. Create 'tags' table
try:
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        color TEXT DEFAULT '#3e577a',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
    """)
    print("Table 'tags' checked/created.")
except sqlite3.Error as e:
    print(f"Error creating 'tags': {e}")

# 3. Create 'file_tags' table
try:
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS file_tags (
        file_id INTEGER NOT NULL,
        tag_id INTEGER NOT NULL,
        PRIMARY KEY (file_id, tag_id),
        FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    )
    """)
    print("Table 'file_tags' checked/created.")
except sqlite3.Error as e:
    print(f"Error creating 'file_tags': {e}")

# 4. Add columns to 'files' table
columns_to_add = {
    'folder_id': 'INTEGER DEFAULT NULL REFERENCES folders(id) ON DELETE SET NULL',
    'is_favorite': 'INTEGER DEFAULT 0',
    'deleted_at': 'DATETIME DEFAULT NULL'
}

# Get existing columns
cursor.execute("PRAGMA table_info(files)")
existing_columns = [row[1] for row in cursor.fetchall()]

for col_name, col_def in columns_to_add.items():
    if col_name not in existing_columns:
        try:
            cursor.execute(f"ALTER TABLE files ADD COLUMN {col_name} {col_def}")
            print(f"Added column '{col_name}' to 'files' table.")
        except sqlite3.Error as e:
            print(f"Error adding column '{col_name}': {e}")
    else:
        print(f"Column '{col_name}' already exists in 'files' table.")

conn.commit()
conn.close()
print("Database schema update completed.")
