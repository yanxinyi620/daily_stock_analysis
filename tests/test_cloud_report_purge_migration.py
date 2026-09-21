"""Static contracts for permanent cloud report deletion.

The executable SQL rollback suite is kept in ``supabase/tests`` because it
requires the dedicated restore project.
"""

from pathlib import Path


MIGRATION = (
    Path(__file__).parents[1]
    / "supabase"
    / "migrations"
    / "202609210002_cloud_report_purge.sql"
)


def test_purge_migration_defines_service_only_two_phase_contract() -> None:
    sql = MIGRATION.read_text(encoding="utf-8").lower()

    assert "add column if not exists purge_started_at timestamptz" in sql
    assert "add column if not exists purged_at timestamptz" in sql
    for name in ("cloud_begin_report_purge", "cloud_finish_report_purge"):
        assert f"create or replace function public.{name}" in sql
        assert "p_user_id uuid, p_task_id uuid" in sql
        assert "security definer" in sql
        assert "revoke all on function public." + name in sql
    assert "grant execute on function public.cloud_begin_report_purge" in sql
    assert "grant execute on function public.cloud_finish_report_purge" in sql
    assert "to service_role" in sql


def test_purge_migration_locks_and_prevents_revival_or_browser_reads() -> None:
    sql = MIGRATION.read_text(encoding="utf-8").lower()

    assert "for update" in sql
    assert "report_execution_active" in sql
    assert "report_publishing" in sql
    assert "report_not_owned" in sql
    assert "purge_started_at is not null" in sql
    assert "purged_at is not null" in sql
    assert "delete from public.analysis_reports" in sql
    assert "report_attachment_exists" in sql
    assert "drop policy if exists reports_owner_read" in sql
    assert "purge_started_at is null" in sql
    assert "v_path not like p_user_id::text || '/' || p_task_id::text || '/%'" in sql

    restore_start = sql.index("create or replace function public.cloud_set_report_deleted")
    restore_end = sql.index("$$;", restore_start)
    assert "report_purge_started" in sql[restore_start:restore_end]

    for function_name in (
        "cloud_begin_publish",
        "cloud_complete_publish",
        "cloud_fail_publish",
        "cloud_cleanup_publish",
    ):
        start = sql.index(f"create or replace function public.{function_name}")
        end = sql.index("$$;", start)
        assert "purge_started_at" in sql[start:end]
