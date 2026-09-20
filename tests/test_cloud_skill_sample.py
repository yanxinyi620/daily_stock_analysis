"""PostgreSQL compilation coverage for skill opinion sample persistence."""

from types import SimpleNamespace

from sqlalchemy.dialects import postgresql

from src.repositories.skill_opinion_sample_repo import SkillOpinionSampleRepository


class _CapturingSession:
    def __init__(self):
        self.statements = []

    def execute(self, statement):
        self.statements.append(statement)
        if len(self.statements) == 1:
            return SimpleNamespace(scalars=lambda: [42])
        return SimpleNamespace(rowcount=1)


class _PostgresDatabase:
    _is_sqlite_engine = False

    def __init__(self):
        self.session = _CapturingSession()

    def _run_write_transaction(self, _description, callback):
        return callback(self.session)


def test_insert_missing_uses_postgresql_conflict_statement_for_cloud_storage():
    db = _PostgresDatabase()
    repository = SkillOpinionSampleRepository(db)

    inserted = repository.insert_missing([
        {
            "analysis_history_id": 42,
            "stock_code": "600519",
            "skill_id": "trend",
            "signal": "buy",
            "confidence": 0.8,
            "sample_schema_version": "v1",
        }
    ])

    assert inserted == 1
    statement = db.session.statements[1]
    compiled = str(statement.compile(dialect=postgresql.dialect()))
    assert "INSERT INTO skill_opinion_samples" in compiled
    assert "ON CONFLICT (analysis_history_id, skill_id, sample_schema_version) DO NOTHING" in compiled
