"""Offline contract tests: the verifier must never contact real cloud services here."""

import importlib.util
from pathlib import Path
from urllib.parse import urlsplit

import pytest


UIDS = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']
TASKS = ['33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444']


@pytest.fixture
def verifier():
    path = Path(__file__).parents[1] / 'scripts' / 'verify_cloud_access.py'
    assert path.exists(), 'Reusable cloud access verifier has not been implemented'
    spec = importlib.util.spec_from_file_location('verify_cloud_access_under_test', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def config_file(tmp_path):
    values = {
        'SUPABASE_URL': 'https://cloud.invalid',
        'SUPABASE_SECRET_KEY': 'sb_secret_private',
        'VITE_SUPABASE_PUBLISHABLE_KEY': 'sb_publishable_public',
        'SUPABASE_PUBLISH_USER_ID': UIDS[0],
        'DSA_TEST_A_EMAIL': 'a@example.invalid', 'DSA_TEST_A_PASSWORD': 'secret-a',
        'DSA_TEST_B_EMAIL': 'b@example.invalid', 'DSA_TEST_B_PASSWORD': 'secret-b',
    }
    path = tmp_path / 'explicit-config'
    path.write_text('\n'.join(f'{key}={value}' for key, value in values.items()))
    return path


class Response:
    def __init__(self, status=200, data=None, text=''):
        self.status_code = status
        self.data = data
        self.text = text

    def json(self):
        return self.data


class Cloud:
    """Stateful HTTP boundary double; no mock of the verifier's decisions."""

    def __init__(self, leak=False, fail_logout=False, fail_second_login=False):
        self.leak = leak
        self.fail_logout = fail_logout
        self.fail_second_login = fail_second_login
        self.calls = []
        self.logouts = []
        self.reports = [dict(task_id=task, user_id=uid, bucket='analysis-reports',
                             object_path=f'{uid}/{task}/' + 'a' * 64 + '.md', markdown=f'report-{i}')
                        for i, (uid, task) in enumerate(zip(UIDS, TASKS))]

    def __call__(self, method, url, *, headers, timeout, allow_redirects, **kwargs):
        assert timeout > 0 and allow_redirects is False
        path = urlsplit(url).path
        body = kwargs.get('json', {})
        params = kwargs.get('params', {})
        auth = headers.get('Authorization', '')
        self.calls.append((method, path, body, params, auth))
        if path == '/auth/v1/token':
            if body.get('email') == 'b@example.invalid' and self.fail_second_login:
                return Response(400, {'message': 'secret-b sb_secret_private'})
            i = 0 if body.get('email') == 'a@example.invalid' or body.get('refresh_token') == 'refresh-0' else 1
            suffix = '-new' if 'refresh_token' in body else ''
            return Response(data={'user': {'id': UIDS[i]}, 'access_token': f'token-{i}{suffix}',
                                  'refresh_token': f'refresh-{i}'})
        if path == '/auth/v1/logout':
            self.logouts.append(auth)
            return Response(500 if self.fail_logout else 204)
        if path.startswith('/rest/v1/rpc/'):
            assert method == 'POST' and auth.startswith('Bearer token-')
            assert body['p_task_id'] in TASKS and body['p_user_id'] in UIDS
            assert body['p_hash'] == 'a' * 64
            if path.endswith('cloud_cleanup_publish'):
                assert body['p_apply'] is False
            return Response(403)
        assert method == 'GET', 'Only auth and rejected RPC calls may use POST'
        service = headers['apikey'] == 'sb_secret_private'
        actor = next((i for i in range(2) if auth.startswith(f'Bearer token-{i}')), None)
        if path.startswith('/storage/v1/object/'):
            i = next(i for i, row in enumerate(self.reports) if path.endswith(row['object_path']))
            return Response(text=self.reports[i]['markdown']) if actor == i else Response(403)
        if path == '/rest/v1/analysis_reports':
            key = 'user_id' if service else 'task_id'
            wanted = params[key].removeprefix('eq.')
            rows = [r for r in self.reports if r[key] == wanted and
                    (service or (actor is not None and (self.leak or r['user_id'] == UIDS[actor])))]
            return Response(data=rows)
        if path == '/rest/v1/analysis_tasks':
            task = params['id'].removeprefix('eq.')
            i = TASKS.index(task)
            row = dict(id=task, user_id=UIDS[i], status='succeeded', content_hash='a' * 64,
                       input_snapshot={'codes': []})
            return Response(data=[row] if service or actor == i else [])
        raise AssertionError('Unexpected request')


def test_missing_config_never_calls_network(verifier, tmp_path, monkeypatch, capsys):
    path = tmp_path / 'empty'
    path.write_text('')
    monkeypatch.setattr(verifier.requests, 'request', lambda *a, **k: pytest.fail('network attempted'))
    assert verifier.main(['--env-file', str(path), '--run']) == 1
    assert 'configuration: FAIL' in capsys.readouterr().out


def test_default_only_validates_configuration(verifier, config_file, monkeypatch, capsys):
    monkeypatch.setattr(verifier.requests, 'request', lambda *a, **k: pytest.fail('network attempted'))
    assert verifier.main(['--env-file', str(config_file)]) == 0
    assert 'configuration: PASS' in capsys.readouterr().out


def test_transport_error_is_redacted(verifier, config_file, monkeypatch, capsys):
    def fail(*args, **kwargs):
        raise RuntimeError('https://cloud.invalid secret-a token-0 sb_secret_private')
    monkeypatch.setattr(verifier.requests, 'request', fail)
    assert verifier.main(['--env-file', str(config_file), '--run']) == 1
    output = capsys.readouterr().out
    assert 'FAIL' in output
    assert all(secret not in output for secret in ['cloud.invalid', 'secret-a', 'token-0', 'sb_secret_private'])


def test_cross_user_leak_fails_and_cleans_both_sessions(verifier, config_file, monkeypatch, capsys):
    cloud = Cloud(leak=True)
    monkeypatch.setattr(verifier.requests, 'request', cloud)
    assert verifier.main(['--env-file', str(config_file), '--run']) == 1
    assert 'cross' in capsys.readouterr().out
    assert set(cloud.logouts) == {'Bearer token-0', 'Bearer token-1'}


def test_second_login_failure_cleans_first_session(verifier, config_file, monkeypatch, capsys):
    cloud = Cloud(fail_second_login=True)
    monkeypatch.setattr(verifier.requests, 'request', cloud)
    assert verifier.main(['--env-file', str(config_file), '--run']) == 1
    assert cloud.logouts == ['Bearer token-0']
    assert 'secret-b' not in capsys.readouterr().out


def test_success_checks_read_isolation_rpcs_and_refresh_cleanup(verifier, config_file, monkeypatch):
    cloud = Cloud()
    monkeypatch.setattr(verifier.requests, 'request', cloud)
    assert verifier.main(['--env-file', str(config_file), '--run']) == 0
    assert len([c for c in cloud.calls if c[1].startswith('/rest/v1/rpc/')]) == 8
    assert len([c for c in cloud.calls if c[0] == 'GET' and not c[4]]) >= 8
    assert len([c for c in cloud.calls if c[1].startswith('/storage/v1/object/public/')]) == 2
    assert set(cloud.logouts) == {'Bearer token-0-new', 'Bearer token-1-new'}


def test_logout_failure_still_cleans_other_session_and_fails(verifier, config_file, monkeypatch):
    cloud = Cloud(fail_logout=True)
    monkeypatch.setattr(verifier.requests, 'request', cloud)
    assert verifier.main(['--env-file', str(config_file), '--run']) == 1
    assert len(cloud.logouts) == 2


def test_missing_existing_report_fails_before_any_rpc(verifier, config_file, monkeypatch):
    cloud = Cloud()
    cloud.reports.pop()
    monkeypatch.setattr(verifier.requests, 'request', cloud)
    assert verifier.main(['--env-file', str(config_file), '--run']) == 1
    assert not any(c[1].startswith('/rest/v1/rpc/') for c in cloud.calls)
    assert len(cloud.logouts) == 2


def test_anonymous_public_attachment_leak_fails(verifier, config_file, monkeypatch):
    cloud = Cloud()

    def transport(method, url, **kwargs):
        if '/storage/v1/object/public/' in url:
            return Response(text='private report')
        return cloud(method, url, **kwargs)

    monkeypatch.setattr(verifier.requests, 'request', transport)
    assert verifier.main(['--env-file', str(config_file), '--run']) == 1
    assert len(cloud.logouts) == 2


def test_malformed_login_response_still_revokes_created_session(verifier, config_file, monkeypatch):
    cloud = Cloud()

    def transport(method, url, **kwargs):
        response = cloud(method, url, **kwargs)
        if '/auth/v1/token' in url:
            response.data.pop('user')
        return response

    monkeypatch.setattr(verifier.requests, 'request', transport)
    assert verifier.main(['--env-file', str(config_file), '--run']) == 1
    assert cloud.logouts == ['Bearer token-0']
