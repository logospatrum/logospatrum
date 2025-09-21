# Christian RAG Service

RAG (Retrieval-Augmented Generation) сервис для поиска по христианской литературе с использованием векторных эмбеддингов Yandex Cloud.

## Возможности

- Загрузка книг из JSON файла с автоматическим созданием эмбеддингов
- Векторный поиск по содержимому книг с использованием PostgreSQL + pgvector
- REST API для выполнения RAG запросов
- Web интерфейс для просмотра загруженных книг
- Автоматическое разбиение текста на чанки с оптимальным пересечением

## Архитектура

- **FastAPI** - веб-фреймворк
- **PostgreSQL + pgvector** - база данных с векторным расширением
- **Yandex Cloud ML SDK** - для создания эмбеддингов
- **Docker** - контейнеризация

## Установка и запуск

### 1. Настройка переменных окружения

Скопируйте `.env.example` в `.env` и заполните:

```bash
cp .env.example .env
```

Укажите ваши данные Yandex Cloud:
- `YANDEX_FOLDER_ID` - ID папки в Yandex Cloud
- `YANDEX_API_KEY` - API ключ для Yandex Cloud ML

### 2. Запуск через Docker Compose

```bash
docker-compose up --build
```

### 3. Локальный запуск

```bash
# Установка зависимостей
pip install -r requirements.txt

# Запуск PostgreSQL с pgvector (или используйте существующий)
docker run -d --name postgres-rag \
  -e POSTGRES_DB=christian_rag \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  pgvector/pgvector:pg16

# Запуск приложения
uvicorn main:app --reload
```

## API

### POST /search
Выполнение RAG запроса

```json
{
  "query": "What is salvation?",
  "max_results": 5,
  "include_metadata": true
}
```

Ответ:
```json
{
  "results": [
    {
      "metadata": {
        "source": "C.S. Lewis - Mere Christianity",
        "author": "C.S. Lewis",
        "title": "Mere Christianity",
        "date": "1952"
      },
      "content": "текст чанка...",
      "score": 0.85
    }
  ]
}
```

### GET /books
Web интерфейс со списком загруженных книг

### GET /health
Проверка состояния сервиса

## Формат JSON файла с книгами

```json
[
  {
    "author": "C.S. Lewis",
    "title": "Mere Christianity", 
    "summary": "краткое описание книги",
    "date": "1952",
    "link": "https://example.com/book.txt",
    "genre": "Christian Apologetics",
    "language": "English"
  }
]
```

## Как работает поиск

1. При запуске сервис загружает книги из `books.json`
2. Для каждой книги создается эмбеддинг по summary + title + author + date
3. Текст книги скачивается по ссылке и разбивается на чанки
4. Для каждого чанка создается эмбеддинг
5. При поиске:
   - Сначала ищутся похожие книги по эмбеддингам summary
   - Затем ищутся релевантные чанки в найденных книгах
   - Возвращаются наиболее релевантные результаты

## Структура базы данных

- `books` - таблица книг с метаданными и эмбеддингами summary
- `chunks` - таблица чанков текста с эмбеддингами
- `migrations` - таблица для отслеживания миграций

### запуск
дев
```bash
# Настройте .env файл
cp .env.example .env
# Отредактируйте с вашими Yandex Cloud данными

# Запустите
docker-compose up --build

```

прод 
```bash
# Настройте продакшен переменные
cp .env.prod.example .env.prod
# Отредактируйте с вашим доменом и email

# Автоматическая настройка SSL
chmod +x scripts/init-letsencrypt.sh
export $(cat .env.prod | xargs)
./scripts/init-letsencrypt.sh

```