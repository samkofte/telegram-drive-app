# Telegram Drive API Documentation

## Requirements
- **PHP API**: Serves as the main entry point.
- **Python Bridge**: Must be running on `http://localhost:8002` (or configured via `PYTHON_API_URL`) to handle large file uploads and streaming.

## Base URL
All API requests should be made to the base URL of your deployed application (e.g., `http://localhost:8080`).

## Authentication
Most endpoints require authentication using a Bearer Token.

### Register
Create a new user account.
- **URL**: `/auth/register`
- **Method**: `POST`
- **Content-Type**: `application/x-www-form-urlencoded` or `application/json`
- **Body Parameters**:
    - `email`: User's email address
    - `username`: Unique username
    - `password`: Password
    - `firstName`: (Optional) First name
    - `lastName`: (Optional) Last name
- **Response**: User object including ID and username.

### Login
Authenticate and receive an access token.
- **URL**: `/auth/login`
- **Method**: `POST`
- **Content-Type**: `application/x-www-form-urlencoded` or `application/json`
- **Body Parameters**:
    - `email`: Registered email
    - `password`: Password
- **Response**:
    ```json
    {
        "access_token": "eyJ...",
        "token_type": "bearer"
    }
    ```

### Get Current User
Get profile details of the logged-in user.
- **URL**: `/auth/me`
- **Method**: `GET`
- **Headers**: `Authorization: Bearer <token>`
- **Response**: User details + statistics (file count, download count).

---

## File Management

### Upload File
Upload a file to Telegram Storage.
- **URL**: `/upload`
- **Method**: `POST`
- **Headers**: `Authorization: Bearer <token>`
- **Body**: `multipart/form-data`
    - `file`: The file object to upload.
- **Response**:
    ```json
    {
        "success": true,
        "message": "filename.ext successfully uploaded",
        "file_info": {
            "filename": "random_name.ext",
            "file_id": 123456789,
            "file_size": 1048576,
            "mime_type": "image/jpeg",
            "upload_date": "2024-01-01T12:00:00+00:00"
        }
    }
    ```
- **Notes**: Supports files up to 2GB (via MTProto).

### List Files
Get a list of all files uploaded by the user.
- **URL**: `/files`
- **Method**: `GET`
- **Headers**: `Authorization: Bearer <token>`
- **Response**: Array of file objects.

### Download File
Download a file. Streamed directly to the client.
- **URL**: `/download/{file_id}`
- **Method**: `GET`
- **Headers**: `Authorization: Bearer <token>`
- **URL Parameters**:
    - `file_id`: The Telegram File ID to download.
- **Response**: Binary file stream (Attachment).

### Stream File (Video)
Stream a file (optimized for video/audio). Supports seeking (Range headers).
- **URL**: `/stream/{file_id}`
- **Method**: `GET`
- **Headers**: `Authorization: Bearer <token>`
- **Response**: Binary stream (Inline).

### Get Direct Telegram URL
Get a temporary direct download URL from Telegram servers (if small file) or proxy URL.
- **URL**: `/telegram-url/{file_id}`
- **Method**: `GET`
- **Headers**: `Authorization: Bearer <token>`
- **Response**:
    ```json
    {
        "success": true,
        "download_url": "https://api.telegram.org/file/..."
    }
    ```

### Delete File
Delete a file from database and Telegram chat.
- **URL**: `/files/{file_id}`
- **Method**: `DELETE`
- **Headers**: `Authorization: Bearer <token>`
- **Response**: Success message.

---

## Admin Endpoints
Requires user role to be `admin`.

### Get System Stats
- **URL**: `/admin/stats`
- **Method**: `GET`
- **Response**: Total users, files, and downloads.

### List Users
- **URL**: `/admin/users`
- **Method**: `GET`
- **Response**: List of all registered users.

### List All Files
- **URL**: `/admin/files`
- **Method**: `GET`
- **Response**: List of all files in the system with uploader info.

### Update User Role
- **URL**: `/admin/users/{id}/role`
- **Method**: `POST`
- **Body**:
    - `role`: `user` or `admin`

### Update User Status
- **URL**: `/admin/users/{id}/status`
- **Method**: `PUT`
- **Body**:
    - `is_active`: `1` (active) or `0` (inactive)

### Delete User
- **URL**: `/admin/users/{id}`
- **Method**: `DELETE`

### Delete File (Admin)
Force delete a file.
- **URL**: `/admin/files/{file_id}`
- **Method**: `DELETE`
