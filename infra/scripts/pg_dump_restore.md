# Postgres dump / restore runbook

После того как локально проиндексировал корпус (`paragraphs` + `embed`), пора перенести БД на VPS.

## Локально → дамп

```bash
# dev-postgres внутри WSL Docker:
wsl -e bash -c "docker exec patristic-postgres-dev pg_dump -U postgres -d patristic -Fc" \
  > patristic-$(date +%Y-%m-%d).dump

ls -lh patristic-*.dump
# Ожидаемо: 3-5 ГБ на полный корпус (709K параграфов × 3 окна = ~2M эмбеддингов × 1024 dim × 4 байт ≈ 8 ГБ raw, но pg_dump сжимает)
```

## Перенос на VPS

```bash
scp patristic-2026-05-15.dump user@vps:/tmp/
```

## VPS → восстановление

На VPS (Postgres 16 + pgvector контейнер уже поднят):

```bash
# Опция А: dropdb + createdb + pg_restore
docker exec patristic-postgres-prod psql -U postgres -c "DROP DATABASE IF EXISTS patristic"
docker exec patristic-postgres-prod psql -U postgres -c "CREATE DATABASE patristic"
docker exec -i patristic-postgres-prod pg_restore -U postgres -d patristic < /tmp/patristic-2026-05-15.dump

# Опция Б: --clean (если БД уже существует и хочешь её перезалить)
docker exec -i patristic-postgres-prod pg_restore -U postgres -d patristic --clean --if-exists \
  < /tmp/patristic-2026-05-15.dump
```

После restore выполнить `VACUUM ANALYZE` чтобы перестроить статистику:

```bash
docker exec patristic-postgres-prod psql -U postgres -d patristic -c "VACUUM ANALYZE"
```

## Проверка

```bash
docker exec patristic-postgres-prod psql -U postgres -d patristic -c "
  SELECT 'authors', COUNT(*) FROM authors
  UNION ALL SELECT 'works', COUNT(*) FROM works
  UNION ALL SELECT 'paragraphs', COUNT(*) FROM paragraphs
  UNION ALL SELECT 'embeddings', COUNT(*) FROM embeddings"
```

Ожидаемые порядки на полном корпусе:
- authors: ~85
- works: ~2000
- paragraphs: ~700K-1M
- embeddings: ~2M-3M (3 окна на абзац)

## Downtime

Полный `pg_restore --clean` для prod = downtime ~5 минут на 5 ГБ дампа. В MVP приемлемо.

Для v2 — blue-green с двумя Postgres-инстансами + переключение `POSTGRES_DSN` в `.env`.

## Обновление данных

При добавлении новых трудов:
1. Локально запусти `pipeline scrape` + `download` + `markdown` для новых авторов.
2. `pipeline paragraphs` дозальёт новые рядки (идемпотентно, ON CONFLICT DO UPDATE).
3. `pipeline embed` re-truncate-ит embeddings table и перегенерит все эмбеддинги. На полном корпусе — ~2-6 часов на GPU.
4. Новый `pg_dump`, scp, `pg_restore --clean`.
