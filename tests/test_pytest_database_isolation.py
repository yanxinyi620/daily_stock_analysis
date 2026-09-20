"""Regression coverage for test environment leaks and live database protection."""
from pathlib import Path
import os
import sqlite3
from unittest.mock import patch

import pytest
from sqlalchemy import create_engine


def test_environment_removal_does_not_escape_test_boundary():
    """Legacy teardown code must not remove the next test's database default."""
    from src.config import Config

    os.environ.pop("DATABASE_PATH", None)
    Config.reset_instance()
    with patch("src.config.setup_env"):
        assert Config.get_instance().database_path == "./data/stock_analysis.db"


def test_pytest_session_never_uses_application_database():
    from src.config import get_config

    configured_path = Path(get_config().database_path).resolve()
    application_path = Path("data/stock_analysis.db").resolve()
    assert configured_path != application_path


@pytest.mark.parametrize("driver", ["sqlite3", "sqlalchemy", "uri"])
def test_connections_to_application_database_are_rejected(driver):
    """The guard must run before opening a file, including direct DBAPI calls."""
    path = Path("data/stock_analysis.db").resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    with pytest.raises(RuntimeError, match="application database"):
        if driver == "sqlalchemy":
            engine = create_engine(f"sqlite:///{path}")
            try:
                with engine.connect():
                    pass
            finally:
                engine.dispose()
        else:
            with sqlite3.connect(path.as_uri() if driver == "uri" else path,
                                 uri=driver == "uri"):
                pass


def test_config_reset_with_empty_environment_cannot_open_live_database():
    from src.config import Config
    from src.storage import DatabaseManager

    with patch.dict(os.environ, {}, clear=True), patch("src.config.setup_env"):
        Config.reset_instance()
        DatabaseManager.reset_instance()
        with pytest.raises(RuntimeError, match="application database"):
            DatabaseManager()


def test_explicit_temporary_and_memory_databases_remain_usable(tmp_path):
    for database in (str(tmp_path / "test.db"), ":memory:"):
        with sqlite3.connect(database) as connection:
            connection.execute("create table marker(value text)")
            connection.execute("insert into marker values ('test')")
            assert connection.execute("select value from marker").fetchone() == ("test",)


def test_symlink_to_application_database_is_rejected(tmp_path):
    alias = tmp_path / "alias.db"
    try:
        alias.symlink_to(Path("data/stock_analysis.db").resolve())
    except OSError:
        pytest.skip("symlink creation is unavailable on this platform")
    with pytest.raises(RuntimeError, match="application database"):
        sqlite3.connect(alias)


@pytest.mark.parametrize("source", ["environment", "dotenv", "dotenv_environment_interpolation"])
def test_original_custom_database_is_protected_before_env_replacement(tmp_path, source):
    """A separate process starts with an existing custom database, as a user would."""
    import subprocess
    import sys

    live = tmp_path / "existing.db"
    with sqlite3.connect(live) as connection:
        connection.execute("create table historical(value text)")
        connection.execute("insert into historical values ('preserve me')")
    before = live.read_bytes()
    env_file = tmp_path / ".env"
    env_file.write_text(f"DATABASE_PATH={live}\n" if source == "dotenv" else "")
    env = dict(os.environ, ENV_FILE=str(env_file))
    env.pop("DATABASE_PATH", None)
    if source == "environment":
        env["DATABASE_PATH"] = str(live)
    elif source == "dotenv_environment_interpolation":
        env_file.write_text(
            f"DSA_TEST_DB_ROOT={tmp_path / 'file-default'}\n"
            "DATABASE_PATH=${DSA_TEST_DB_ROOT}/existing.db\n"
        )
        env["DSA_TEST_DB_ROOT"] = str(tmp_path)
    code = """
import runpy, sqlite3, sys
hooks = runpy.run_path(sys.argv[1])
try:
    try:
        sqlite3.connect(sys.argv[2])
    except RuntimeError as error:
        assert 'application database' in str(error)
    else:
        raise AssertionError('custom application database was opened')
finally:
    hooks['pytest_sessionfinish'](None, None)
"""
    result = subprocess.run(
        [sys.executable, "-c", code, str(Path(__file__).with_name("conftest.py")), str(live)],
        env=env, capture_output=True, text=True, timeout=30,
    )
    assert result.returncode == 0, result.stderr
    assert live.read_bytes() == before
