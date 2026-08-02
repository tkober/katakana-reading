-- Local development only: create the two roles the backend expects, with
-- throwaway passwords matching compose.yaml. Runs once, on the first start of
-- an empty postgres volume (docker-entrypoint-initdb.d), connected to the
-- POSTGRES_DB database as the superuser.
--
-- The production equivalent (against the shared postgres-core instance) is
-- dbeaver/create_users_and_db.sql + dbeaver/grant_privileges.sql.

CREATE ROLE katakana_owner WITH LOGIN PASSWORD 'katakana';
CREATE ROLE katakana_app WITH LOGIN PASSWORD 'katakana';

ALTER DATABASE katakana OWNER TO katakana_owner;
GRANT CONNECT ON DATABASE katakana TO katakana_app;

ALTER SCHEMA public OWNER TO katakana_owner;
GRANT USAGE ON SCHEMA public TO katakana_app;

-- The app role never runs DDL; it inherits access to the tables the owner
-- creates at startup from these default privileges.
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
