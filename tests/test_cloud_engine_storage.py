"""Offline contract checks for private local-runner PostgreSQL storage."""

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

import pytest
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateTable

from src.services.cloud_engine_storage import CLOUD_ENGINE_SCHEMA, initialize_cloud_engine
from src.storage import Base, DatabaseManager


@pytest.fixture(autouse=True)
def _reset_database_manager():
    DatabaseManager.reset_instance()
    yield
    DatabaseManager.reset_instance()


def test_cloud_schema_accepts_only_tls_psycopg_postgres_urls():
    assert DatabaseManager._validate_cloud_schema(
        "postgresql+psycopg://runner@example.test/dsa?sslmode=verify-full",
        CLOUD_ENGINE_SCHEMA,
    ) == CLOUD_ENGINE_SCHEMA

    with pytest.raises(ValueError, match="postgresql\\+psycopg"):
        DatabaseManager._validate_cloud_schema("postgresql://example.test/dsa", CLOUD_ENGINE_SCHEMA)
    with pytest.raises(ValueError, match="verify-full"):
        DatabaseManager._validate_cloud_schema(
            "postgresql+psycopg://example.test/dsa?sslmode=disable", CLOUD_ENGINE_SCHEMA
        )
    with pytest.raises(ValueError, match="verify-full"):
        DatabaseManager._validate_cloud_schema(
            "postgresql+psycopg://example.test/dsa", CLOUD_ENGINE_SCHEMA
        )
    with pytest.raises(ValueError, match="postgresql\\+psycopg"):
        DatabaseManager._validate_cloud_schema(
            "postgresql+psycopg2://example.test/dsa?sslmode=verify-full", CLOUD_ENGINE_SCHEMA
        )
    with pytest.raises(ValueError, match="fixed private cloud schema"):
        DatabaseManager._validate_cloud_schema(
            "postgresql+psycopg://example.test/dsa?sslmode=verify-full", "public"
        )


def test_cloud_initializer_refuses_to_reuse_local_singleton():
    DatabaseManager(db_url="sqlite:///:memory:")
    with pytest.raises(RuntimeError, match="cannot reuse an existing local"):
        initialize_cloud_engine("postgresql+psycopg://example.test/dsa?sslmode=verify-full")


def test_private_migration_covers_all_orm_tables_and_revokes_api_roles():
    migration = Path("supabase/migrations/202609180002_cloud_engine.sql").read_text(encoding="utf-8")
    assert "create schema dsa_engine;" in migration
    assert "set local search_path to dsa_engine;" in migration
    for table_name in Base.metadata.tables:
        assert f"CREATE TABLE {table_name}" in migration
    assert "IF NOT EXISTS" not in migration
    assert "revoke all on schema dsa_engine from public, anon, authenticated;" in migration
    assert "revoke all on all tables in schema dsa_engine from public, anon, authenticated;" in migration
    assert "revoke all on all sequences in schema dsa_engine from public, anon, authenticated;" in migration


def test_private_schema_verification_fails_closed_when_any_orm_table_is_missing():
    manager = DatabaseManager(db_url="sqlite:///:memory:")
    manager._cloud_schema = CLOUD_ENGINE_SCHEMA
    manager._engine = MagicMock()
    manager._engine.connect.return_value.__enter__.return_value.execute.return_value.scalar_one.return_value = CLOUD_ENGINE_SCHEMA
    inspector = Mock()
    inspector.has_schema.return_value = True
    inspector.get_table_names.return_value = list(Base.metadata.tables)[1:]

    with patch("src.storage.inspect", return_value=inspector), pytest.raises(RuntimeError, match="incomplete"):
        manager._verify_cloud_schema()


def test_private_schema_verification_rejects_a_connection_on_another_schema():
    manager = DatabaseManager(db_url="sqlite:///:memory:")
    manager._cloud_schema = CLOUD_ENGINE_SCHEMA
    manager._engine = MagicMock()
    manager._engine.connect.return_value.__enter__.return_value.execute.return_value.scalar_one.return_value = "public"
    inspector = Mock()
    inspector.has_schema.return_value = True

    with patch("src.storage.inspect", return_value=inspector), pytest.raises(RuntimeError, match="not selected"):
        manager._verify_cloud_schema()


def test_cloud_engine_construction_uses_bounded_pool_and_never_creates_tables():
    fake_engine = MagicMock()
    fake_engine.url.get_backend_name.return_value = "postgresql"
    fake_engine.dialect.name = "postgresql"
    fake_engine.connect.return_value.__enter__.return_value.execute.return_value.scalar_one.return_value = CLOUD_ENGINE_SCHEMA
    inspector = Mock()
    inspector.has_schema.return_value = True
    inspector.get_table_names.return_value = list(Base.metadata.tables)
    inspector.get_columns.side_effect = lambda table, schema: [
        {"name": column.name} for column in Base.metadata.tables[table].columns
    ]
    config = SimpleNamespace(
        sqlite_wal_enabled=True,
        sqlite_busy_timeout_ms=1000,
        sqlite_write_retry_max=0,
        sqlite_write_retry_base_delay=0.01,
    )
    url = "postgresql+psycopg://runner@example.test/dsa?sslmode=verify-full"

    with (
        patch("src.storage.get_config", return_value=config),
        patch("src.storage.create_engine", return_value=fake_engine) as create_engine,
        patch("src.storage.inspect", return_value=inspector),
        patch("src.storage.event.listens_for", side_effect=lambda *_args: lambda fn: fn),
        patch.object(Base.metadata, "create_all") as create_all,
    ):
        manager = initialize_cloud_engine(url)

    assert manager._cloud_schema == CLOUD_ENGINE_SCHEMA
    create_engine.assert_called_once_with(
        url,
        echo=False,
        pool_pre_ping=True,
        pool_size=2,
        max_overflow=0,
        pool_timeout=30,
        connect_args={"connect_timeout": 10},
    )
    create_all.assert_not_called()


def test_orm_metadata_compiles_for_postgresql_and_migration_handles_long_indexes():
    dialect = postgresql.dialect()
    for table in Base.metadata.sorted_tables:
        assert "CREATE TABLE" in str(CreateTable(table).compile(dialect=dialect))
    migration = Path("supabase/migrations/202609180002_cloud_engine.sql").read_text(encoding="utf-8")
    assert "PostgreSQL identifier shortened from: ix_decision_signal_report_type_market_stock_profile_action_horizon_phase" in migration


def test_cloud_url_is_never_part_of_success_log_message():
    # The initializer reaches the DBAPI before a success message. This source-level
    # check prevents a future reintroduction of the old raw-URL logging behavior.
    source = Path("src/storage.py").read_text(encoding="utf-8")
    assert 'logger.info("数据库初始化完成: dialect=%s cloud_schema=%s"' in source
    assert 'logger.info(f"数据库初始化完成: {db_url}")' not in source
