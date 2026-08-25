from pathlib import Path


def test_pytest_session_never_uses_application_database():
    """A singleton reset during tests must not fall back to the app database."""
    from src.config import get_config

    configured_path = Path(get_config().database_path).resolve()
    application_path = Path("data/stock_analysis.db").resolve()

    assert configured_path != application_path
