-- infra/migrations/002_abuse_budget.sql
CREATE TABLE IF NOT EXISTS budget_usage (
    subject_key  TEXT          NOT NULL,
    bucket       TEXT          NOT NULL,
    used_rub     NUMERIC(12,4) NOT NULL DEFAULT 0,
    updated_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    PRIMARY KEY (subject_key, bucket)
);
CREATE INDEX IF NOT EXISTS budget_usage_bucket_idx ON budget_usage (bucket);

INSERT INTO schema_migrations(version) VALUES ('002_abuse_budget') ON CONFLICT DO NOTHING;
