"""Private Postgres storage bootstrap for the local cloud runner.

This module deliberately has no Supabase HTTP dependency.  The runner uses a
dedicated PostgreSQL credential and only the non-public ``dsa_engine`` schema.
"""

from src.storage import DatabaseManager

CLOUD_ENGINE_SCHEMA = "dsa_engine"


def initialize_cloud_engine(db_url: str) -> DatabaseManager:
    """Initialize and verify bounded private runner storage.

    The schema must already have been provisioned by the SQL migration.  This
    function never creates or upgrades tables, and fails closed if the existing
    singleton points to local SQLite or another cloud URL.
    """
    manager = DatabaseManager(db_url=db_url, cloud_schema=CLOUD_ENGINE_SCHEMA)
    if manager._cloud_schema != CLOUD_ENGINE_SCHEMA:
        raise RuntimeError("Cloud engine storage did not select its private schema.")
    return manager
