# Telegram Drive PHP (Hybrid)

Fully functional Telegram Drive implementation using PHP as the core API/Frontend and a minimal Python bridge for high-performance MTProto file operations.

## 🌟 Features
- **Unlimited Cloud Storage**: Uses Telegram as a storage backend.
- **Large File Support**: Upload and download files up to 2GB (via Python Bridge).
- **Video Streaming**: Stream uploaded videos directly in the browser with seek support (Range headers).
- **User Management**: Authentication system with JWT, user roles (Admin/User), and profile management.
- **Modern UI**: Glassmorphism design, responsive dashboard, and drag-and-drop uploads.
- **API System**: Dedicated API endpoints with API Key support for external integrations.

## 🏗 Architecture
This project uses a hybrid architecture to combine the best of both worlds:
- **PHP 8.2+ (Slim Framework)**: Handles the web server, authentication, database, UI, and business logic.
- **Python (FastAPI + Telethon)**: Runs as a microservice (Port 8002) to handle heavy MTProto operations (Large uploads/downloads/streaming) that PHP struggles with.

## 🚀 Installation

### 1. Prerequisites
- PHP 8.2 or higher
- Composer
- Python 3.9+
- MySQL/MariaDB

### 2. Setup (PHP)
1. Clone the repository.
2. Install PHP dependencies:
   ```bash
   composer install
   ```
3. Configure your environment:
   - Rename `.env.example` to `.env` (or create one).
   - Set your database credentials and Telegram API keys.
   ```ini
   DB_HOST=localhost
   DB_NAME=telegram_drive
   DB_USER=root
   DB_PASS=
   
   TELEGRAM_BOT_TOKEN=your_bot_token
   TELEGRAM_API_ID=your_api_id
   TELEGRAM_API_HASH=your_api_hash
   TELEGRAM_CHAT_ID=your_chat_id
   
   PYTHON_API_URL=http://localhost:8002
   SECRET_KEY=your_random_secret_string
   ```
4. Start the PHP server:
   ```bash
   php -S localhost:8000 -t public
   ```

### 3. Setup (Python Bridge)
1. Go to `python_bridge` directory.
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Run the bridge service:
   ```bash
   python main.py
   ```

## 🛠 Usage
- **Web Interface**: Go to `http://localhost:8000`.
- **API Documentation**: See `public/api/documentation.md`.
- **API Tester**: Go to `http://localhost:8000/api/tester.html`.

## 🔒 Security
- **JWT Auth**: Secure user sessions.
- **API Keys**: Generate API keys in your profile for external access.
- **Role-Based Access**: Admins have a dedicated dashboard for user/file management.

## 🤝 Contributing
1. Fork the project.
2. Create your feature branch.
3. Commit your changes.
4. Push to the branch.
5. Open a Pull Request.

## 📝 License
This project is open-source and available under the generic MIT license.
