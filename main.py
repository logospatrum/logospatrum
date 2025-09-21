import logging
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from fastapi.requests import Request

from database import db_conn
from migrations import migrate_db
from models import RAGRequest, RAGResponse
from rag_service import rag_service
from repository import book_repository

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

templates = Jinja2Templates(directory="templates")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db_conn.init_pool()
    await migrate_db()

    books_json_path = "books.json"
    if os.path.exists(books_json_path):
        logger.info("Loading books from JSON...")
        await rag_service.load_books_from_json(books_json_path)
        logger.info("Books loaded successfully")
    else:
        logger.warning(f"Books file {books_json_path} not found")

    yield

    await db_conn.close_pool()


app = FastAPI(title="Christian RAG Service", lifespan=lifespan)


@app.post("/search", response_model=RAGResponse)
async def search_rag(request: RAGRequest):
    try:
        return await rag_service.search(request)
    except Exception as e:
        logger.error(f"Search error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/books", response_class=HTMLResponse)
async def get_books_page(request: Request):
    try:
        books = await book_repository.get_all_books()
        return templates.TemplateResponse("books.html", {
            "request": request,
            "books": books,
            "total_books": len(books)
        })
    except Exception as e:
        logger.error(f"Books page error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
