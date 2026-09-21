"""Static contract checks for the cloud report trash migration.

The executable SQL integration suite lives in ``supabase/tests`` and is run
against the dedicated restore project.  These checks keep the migration's
security-critical shape visible in the regular Python test suite.
"""

from pathlib import Path


MIGRATION = (
    Path(__file__).parents[1]
    / "supabase"
    / "migrations"
    / "202609210001_cloud_report_trash.sql"
)


def test_cloud_report_trash_migration_defines_locked_owner_rpc() -> None:
    sql = MIGRATION.read_text(encoding="utf-8").lower()

    assert "add column if not exists deleted_at timestamptz" in sql
    assert "create or replace function public.cloud_set_report_deleted" in sql
    assert "security definer" in sql
    assert "auth.uid()" in sql
    assert "for update" in sql
    assert "member_inactive" in sql
    assert "report_not_owned" in sql
    assert "report_publishing" in sql
    assert "report_execution_active" in sql
    assert "report_trashed" in sql
    assert "revoke all on function public.cloud_set_report_deleted" in sql
    assert "grant execute on function public.cloud_set_report_deleted" in sql
    assert "to authenticated" in sql


def test_cloud_report_trash_migration_prevents_publisher_revival() -> None:
    sql = MIGRATION.read_text(encoding="utf-8").lower()

    for function_name in (
        "public.cloud_begin_publish",
        "public.cloud_complete_publish",
        "public.cloud_fail_publish",
        "public.cloud_cleanup_publish",
    ):
        assert f"create or replace function {function_name}" in sql

    for function_name in (
        "cloud_begin_publish",
        "cloud_complete_publish",
        "cloud_fail_publish",
        "cloud_cleanup_publish",
    ):
        function_start = sql.index(f"create or replace function public.{function_name}")
        function_end = sql.index("$$;", function_start)
        assert "deleted_at" in sql[function_start:function_end]
