-- One-off bootstrap for the katakana database on a shared Postgres server.
-- Run as the postgres superuser, substituting the ${...} placeholders with the
-- values from the deployment's .env:
--
--   docker exec -i postgres-core psql -U postgres < create_users_and_db.sql
--
-- Then run grant_privileges.sql against the new database.

-- Create Roles
CREATE ROLE katakana_owner
  WITH LOGIN
  PASSWORD '${DB_OWNER_PASSWORD}';

CREATE ROLE katakana_app
  WITH LOGIN
  PASSWORD '${DB_PASSWORD}';

-- Create Database
CREATE DATABASE katakana
  OWNER katakana_owner;

-- Allow app user to connect
GRANT CONNECT ON DATABASE katakana
  TO katakana_app;
