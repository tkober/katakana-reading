-- Run against the katakana database (NOT postgres) after
-- create_users_and_db.sql:
--
--   docker exec -i postgres-core psql -U postgres -d katakana < grant_privileges.sql
--
-- The tables themselves are created by the backend on startup, connecting as
-- katakana_owner. The app role never runs DDL — its access to those tables
-- comes from the default privileges below, so the backend issues no GRANT.

ALTER SCHEMA public OWNER TO katakana_owner;

GRANT USAGE ON SCHEMA public
  TO katakana_app;

ALTER DEFAULT PRIVILEGES
  FOR ROLE katakana_owner
  IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLES
  TO katakana_app;

ALTER DEFAULT PRIVILEGES
  FOR ROLE katakana_owner
  IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE
  ON SEQUENCES
  TO katakana_app;
