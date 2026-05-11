# Smart Library API - Documentation

## Overview

The Smart Library API provides endpoints for browsing textbooks, streaming PDF files, and performing RAG (Retrieval-Augmented Generation) searches across textbook content.

## Base URL

All endpoints are prefixed with `/api/library`

## Endpoints

### 1. GET `/api/library/books`

Get a list of all available textbooks.

**Query Parameters:**
- `subject` (optional): Filter by subject (e.g., "Mathematics")
- `grade` (optional): Filter by grade (e.g., 10)

**Response:**
```json
[
  {
    "id": 1,
    "title": "Algebra 10",
    "subject": "Mathematics",
    "grade": 10,
    "total_pages": 250,
    "total_chunks": 1250,
    "file_name": "algebra_10.pdf",
    "created_at": "2025-01-27T10:00:00Z",
    "updated_at": "2025-01-27T10:00:00Z"
  }
]
```

**Example:**
```bash
# Get all books
GET /api/library/books

# Filter by subject
GET /api/library/books?subject=Mathematics

# Filter by grade
GET /api/library/books?grade=10

# Combined filters
GET /api/library/books?subject=Physics&grade=11
```

---

### 2. GET `/api/library/books/{book_id}`

Get detailed information about a specific textbook.

**Path Parameters:**
- `book_id` (required): The textbook ID

**Response:**
```json
{
  "id": 1,
  "title": "Algebra 10",
  "subject": "Mathematics",
  "grade": 10,
  "total_pages": 250,
  "total_chunks": 1250,
  "file_name": "algebra_10.pdf",
  "file_path": "/absolute/path/to/algebra_10.pdf",
  "created_at": "2025-01-27T10:00:00Z",
  "updated_at": "2025-01-27T10:00:00Z"
}
```

**Example:**
```bash
GET /api/library/books/1
```

---

### 3. GET `/api/library/books/{book_id}/pdf`

**Critical Endpoint:** Stream the PDF file for a textbook.

**Path Parameters:**
- `book_id` (required): The textbook ID

**Response:**
- Binary PDF file with headers:
  - `Content-Type: application/pdf`
  - `Content-Disposition: inline; filename="book.pdf"`

**Security:**
- ✅ **LFI Protection:** File path is looked up from database (not user input)
- ✅ **Path Validation:** Ensures path is absolute and file exists
- ✅ **File Type Check:** Verifies file is actually a PDF

**Example:**
```bash
# Opens PDF in browser
GET /api/library/books/1/pdf

# Or use in <iframe> or <object> tag
<iframe src="/api/library/books/1/pdf"></iframe>
```

**Error Responses:**
- `404`: Textbook not found or PDF file missing
- `400`: Invalid file path or not a PDF file

---

### 4. POST `/api/library/search`

RAG Search Endpoint - Search textbook chunks using vector similarity.

**Request Body:**
```json
{
  "query": "Explain quadratic equations",
  "subject": "Mathematics",  // optional
  "grade": 10,               // optional
  "limit": 5                 // optional, default: 5
}
```

**Response:**
```json
[
  {
    "book_id": 1,
    "book_title": "Algebra 10",
    "subject": "Mathematics",
    "grade": 10,
    "page_number": 42,
    "snippet": "A quadratic equation is a polynomial equation of degree 2...",
    "relevance_score": 0.9234
  }
]
```

**How It Works:**
1. Converts query to vector embedding using OpenAI
2. Searches `textbook_chunks` table using pgvector cosine similarity
3. Returns most relevant chunks with page numbers for citation
4. Filters by subject/grade if provided

**Example:**
```bash
POST /api/library/search
Content-Type: application/json

{
  "query": "How to solve quadratic equations",
  "subject": "Mathematics",
  "limit": 3
}
```

---

## Security Features

### LFI (Local File Inclusion) Protection

The PDF serving endpoint is protected against directory traversal attacks:

1. **Database Lookup:** File path is retrieved from the `Textbook` table (populated securely via ingestion script)
2. **No User Input:** The file path is never constructed from user input
3. **Path Validation:** 
   - Ensures path is absolute
   - Verifies file exists
   - Checks file extension is `.pdf`

### Example Attack Prevention

❌ **Vulnerable (NOT implemented):**
```python
# BAD - User can traverse directories
file_path = f"/books/{user_input}"  # user_input = "../../etc/passwd"
```

✅ **Secure (Our implementation):**
```python
# GOOD - Path from database only
textbook = db.query(Textbook).filter(Textbook.id == book_id).first()
file_path = textbook.file_path  # From database, not user input
```

---

## Frontend Integration

The frontend calls these endpoints from the active library page under `frontend/src/app/components/dashboard/library/` (the legacy `frontend/src/api/library.js` and `features/library/` adapter were retired in v2.0):

```javascript
// Get all books
const books = await getTextbooks();

// Get books with filters
const mathBooks = await getTextbooks('Mathematics', 10);

// Get single book
const book = await getTextbook(1);

// Get PDF URL
const pdfUrl = getTextbookPDFUrl(1);

// Search textbooks
const citations = await searchTextbooks('quadratic equations', 'Mathematics', 10, 5);
```

---

## Database Schema

### `textbooks` Table
- `id`: Primary key
- `title`: Book title
- `subject`: Subject name (indexed)
- `grade`: Grade level (indexed)
- `file_path`: Absolute path to PDF file (unique)
- `file_name`: Just the filename
- `total_pages`: Number of pages
- `total_chunks`: Number of text chunks

### `textbook_chunks` Table
- `id`: Primary key
- `textbook_id`: Foreign key to textbooks
- `page_number`: Page number (CRITICAL for citations)
- `content`: Text content
- `chunk_embedding`: Vector embedding (1536 dimensions)

---

## Error Handling

All endpoints return appropriate HTTP status codes:

- `200`: Success
- `400`: Bad Request (invalid parameters)
- `404`: Not Found (textbook or file doesn't exist)
- `500`: Internal Server Error (embedding generation failed, etc.)

Error response format:
```json
{
  "detail": "Error message here"
}
```

---

## Testing

### Using curl

```bash
# Get all books
curl http://localhost:8000/api/library/books

# Get filtered books
curl "http://localhost:8000/api/library/books?subject=Mathematics&grade=10"

# Get single book
curl http://localhost:8000/api/library/books/1

# Download PDF
curl -O http://localhost:8000/api/library/books/1/pdf

# Search
curl -X POST http://localhost:8000/api/library/search \
  -H "Content-Type: application/json" \
  -d '{"query": "quadratic equations", "limit": 3}'
```

### Using Python

```python
import requests

# Get all books
response = requests.get("http://localhost:8000/api/library/books")
books = response.json()

# Search
response = requests.post(
    "http://localhost:8000/api/library/search",
    json={
        "query": "Explain quadratic equations",
        "subject": "Mathematics",
        "limit": 5
    }
)
citations = response.json()
```

---

## Notes

1. **File Storage:** PDF files should be stored in a location accessible to the backend server. The ingestion script stores absolute paths in the database.

2. **Performance:** The search endpoint uses vector similarity which is fast with pgvector indexes. For large libraries, consider adding result caching.

3. **Deep Linking:** Citations include `page_number` which can be used to deep-link to specific pages in the PDF reader.

4. **CORS:** The API respects CORS settings configured in `main.py` for the frontend URL.

