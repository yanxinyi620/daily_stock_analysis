"""Release safeguards for the public repository's optional cloud daily job."""
from pathlib import Path
import yaml


def test_cloud_daily_is_opt_in_and_cannot_upload_private_packages():
    workflow = yaml.safe_load(Path('.github/workflows/00-daily-analysis.yml').read_text())
    job = workflow['jobs']['analyze']
    assert 'CLOUD_DAILY_ENABLED' in job['env']['CLOUD_DAILY_ACTIVE']
    assert 'cloud-full' in job['env']['CLOUD_DAILY_ACTIVE']
    upload = next(s for s in job['steps'] if s.get('uses', '').startswith('actions/upload-artifact'))
    assert "env.CLOUD_DAILY_ACTIVE != 'true'" in upload['if']
    result = next(s for s in job['steps'] if s.get('name') == '显示运行结果')
    assert "env.CLOUD_DAILY_ACTIVE != 'true'" in result['if']
    execute = next(s for s in job['steps'] if s.get('name') == '执行股票分析')
    assert 'scripts/run_cloud_daily.py' in execute['run']
    assert execute['run'].index('scripts/run_cloud_daily.py') < execute['run'].index('📋 配置检查')
    assert 'SUPABASE_SECRET_KEY' in execute['env']
    assert workflow['permissions'] == {'contents': 'read'}
