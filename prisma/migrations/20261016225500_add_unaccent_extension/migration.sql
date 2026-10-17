-- The product search ignores accents. The extension lives in public so every schema of the
-- database, the test one included, reaches the same function.
CREATE EXTENSION IF NOT EXISTS "unaccent" SCHEMA public;
