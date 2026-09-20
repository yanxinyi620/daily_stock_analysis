#!/usr/bin/env python3
"""Check existing cloud reports and access boundaries without publishing data.

Requires an explicit --env-file; without --run only validates configuration.
Online mode creates two password-login sessions and revokes them in finally.
The service key is used only for GET requests. Rejected publication RPC probes
reuse existing succeeded tasks; cleanup always uses p_apply=False.
"""

import argparse
import re
from pathlib import Path
from urllib.parse import quote, urlsplit
from uuid import UUID

import requests
from dotenv import dotenv_values


REQUIRED = (
    'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_PUBLISH_USER_ID', 'DSA_TEST_A_EMAIL', 'DSA_TEST_A_PASSWORD',
    'DSA_TEST_B_EMAIL', 'DSA_TEST_B_PASSWORD',
)


class CheckFailed(Exception):
    """Carries only a fixed check label and an optional numeric HTTP status."""

    def __init__(self, name, status=None):
        self.name = name
        self.status = status if type(status) is int else None


def check(condition, name, status=None):
    if not condition:
        raise CheckFailed(name, status)


def report_failure(error):
    suffix = f' (status={error.status})' if error.status is not None else ''
    print(f'{error.name}: FAIL{suffix}', flush=True)


class SafeParser(argparse.ArgumentParser):
    def error(self, message):
        # argparse normally echoes bad arguments, which may contain credentials.
        raise CheckFailed('arguments')


def load_config(filename):
    try:
        check(Path(filename).is_file(), 'configuration')
        # Do not implicitly discover .env or interpolate process environment data.
        config = dotenv_values(filename, interpolate=False)
        check(all(isinstance(config.get(k), str) and config[k].strip() for k in REQUIRED),
              'configuration')
        parsed = urlsplit(config['SUPABASE_URL'])
        check(parsed.scheme == 'https' and parsed.hostname and not parsed.username
              and not parsed.password and parsed.path in ('', '/')
              and not parsed.query and not parsed.fragment, 'configuration')
        config['SUPABASE_URL'] = config['SUPABASE_URL'].rstrip('/')
        config['SUPABASE_PUBLISH_USER_ID'] = str(UUID(config['SUPABASE_PUBLISH_USER_ID']))
        check(config['DSA_TEST_A_EMAIL'].casefold() != config['DSA_TEST_B_EMAIL'].casefold(),
              'configuration')
        return config
    except Exception:
        raise CheckFailed('configuration') from None


class Verifier:
    def __init__(self, config):
        self.config = config
        self.sessions = {}
        self.public_headers = {'apikey': config['VITE_SUPABASE_PUBLISHABLE_KEY']}
        secret = config['SUPABASE_SECRET_KEY']
        self.service_headers = {'apikey': secret}
        if not secret.startswith('sb_secret_'):
            self.service_headers['Authorization'] = f'Bearer {secret}'

    def request(self, name, method, path, headers, **kwargs):
        try:
            return requests.request(method, self.config['SUPABASE_URL'] + path,
                                    headers=headers, timeout=30, allow_redirects=False, **kwargs)
        except Exception:
            raise CheckFailed(name) from None

    def json(self, response, name):
        try:
            return response.json()
        except Exception:
            raise CheckFailed(name, response.status_code) from None

    def headers(self, label):
        return {**self.public_headers, 'Authorization': 'Bearer ' + self.sessions[label]['access_token']}

    def login(self, label):
        name = label + ' login'
        response = self.request(name, 'POST', '/auth/v1/token?grant_type=password', self.public_headers,
                                json={'email': self.config[f'DSA_TEST_{label}_EMAIL'],
                                      'password': self.config[f'DSA_TEST_{label}_PASSWORD']})
        check(response.status_code == 200, name, response.status_code)
        body = self.json(response, name)
        # Retain usable tokens before checking the remaining response fields, so
        # malformed successful responses still get a best-effort local logout.
        if isinstance(body, dict) and isinstance(body.get('access_token'), str) and body['access_token']:
            self.sessions[label] = body
        try:
            check(label in self.sessions and isinstance(body['refresh_token'], str)
                  and bool(body['refresh_token']), name)
            uid = str(UUID(body['user']['id']))
        except Exception:
            raise CheckFailed(name) from None
        print(f'{name}: PASS', flush=True)
        return uid

    def rows(self, name, table, headers, params):
        response = self.request(name, 'GET', '/rest/v1/' + table, headers, params=params)
        check(response.status_code == 200, name, response.status_code)
        rows = self.json(response, name)
        check(isinstance(rows, list) and all(isinstance(row, dict) for row in rows), name)
        return rows

    def fixture(self, label, uid):
        name = label + ' existing report'
        rows = self.rows(name, 'analysis_reports', self.service_headers,
                         {'user_id': 'eq.' + uid,
                          'select': 'task_id,user_id,object_path,bucket,markdown',
                          'order': 'created_at.desc,task_id.desc', 'limit': '1'})
        check(len(rows) == 1, name)
        row = rows[0]
        try:
            task_id = str(UUID(row['task_id']))
            check(row['user_id'] == uid and isinstance(row['markdown'], str)
                  and bool(row['markdown']) and isinstance(row['bucket'], str) and bool(row['bucket'])
                  and isinstance(row['object_path'], str)
                  and row['object_path'].startswith(uid + '/' + task_id + '/'), name)
        except Exception:
            raise CheckFailed(name) from None
        tasks = self.rows(name, 'analysis_tasks', self.service_headers,
                          {'id': 'eq.' + task_id,
                           'select': 'id,user_id,status,content_hash,input_snapshot'})
        check(len(tasks) == 1, name)
        task = tasks[0]
        check(task.get('id') == task_id and task.get('user_id') == uid
              and task.get('status') == 'succeeded'
              and isinstance(task.get('content_hash'), str)
              and re.fullmatch('[a-f0-9]{64}', task['content_hash'])
              and isinstance(task.get('input_snapshot'), dict), name)
        print(f'{name}: PASS', flush=True)
        return row, task

    def read_report(self, name, headers, row, expected, anonymous=False):
        for table, key in [('analysis_reports', 'task_id'), ('analysis_tasks', 'id')]:
            label = name + ' ' + table
            response = self.request(label, 'GET', '/rest/v1/' + table, headers,
                                    params={key: 'eq.' + row['task_id'], 'select': key + ',user_id'})
            if anonymous and response.status_code in (401, 403):
                print(f'{label}: PASS', flush=True)
                continue
            check(response.status_code == 200, label, response.status_code)
            rows = self.json(response, label)
            check(isinstance(rows, list) and len(rows) == (1 if expected else 0), label)
            if expected:
                check(isinstance(rows[0], dict) and rows[0].get('user_id') == row['user_id']
                      and rows[0].get(key) == row['task_id'], label)
            print(f'{label}: PASS', flush=True)
        label = name + ' attachment'
        path = '/storage/v1/object/authenticated/' + quote(row['bucket'], safe='')
        path += '/' + quote(row['object_path'], safe='/')
        response = self.request(label, 'GET', path, headers)
        check((response.status_code == 200 and response.text == row['markdown']) if expected
              else response.status_code in (400, 401, 403, 404), label, response.status_code)
        print(f'{label}: PASS', flush=True)
        if anonymous:
            # A public bucket can expose an object even when the authenticated
            # endpoint correctly rejects anonymous access.
            label = name + ' public attachment'
            public_path = path.replace('/object/authenticated/', '/object/public/', 1)
            response = self.request(label, 'GET', public_path, headers)
            check(response.status_code in (400, 401, 403, 404), label, response.status_code)
            print(f'{label}: PASS', flush=True)

    def denied_rpcs(self, label, row, task):
        common = {'p_task_id': task['id'], 'p_user_id': task['user_id'], 'p_hash': task['content_hash']}
        for rpc, args in (
            ('cloud_begin_publish', {'p_input': task['input_snapshot']}),
            ('cloud_complete_publish', {'p_payload': {}, 'p_path': row['object_path']}),
            ('cloud_fail_publish', {}),
            ('cloud_cleanup_publish', {'p_apply': False}),
        ):
            name = label + ' ' + rpc + ' denied'
            response = self.request(name, 'POST', '/rest/v1/rpc/' + rpc, self.headers(label),
                                    json={**common, **args})
            check(response.status_code in (401, 403), name, response.status_code)
            print(f'{name}: PASS', flush=True)

    def refresh(self, label, uid):
        name = label + ' refresh'
        response = self.request(name, 'POST', '/auth/v1/token?grant_type=refresh_token',
                                self.public_headers,
                                json={'refresh_token': self.sessions[label]['refresh_token']})
        check(response.status_code == 200, name, response.status_code)
        body = self.json(response, name)
        if isinstance(body, dict) and isinstance(body.get('access_token'), str) and body['access_token']:
            self.sessions[label] = body
        else:
            raise CheckFailed(name)
        check(isinstance(body.get('user'), dict) and body['user'].get('id') == uid, name)
        print(f'{name}: PASS', flush=True)

    def run(self):
        passed = True
        try:
            users = {label: self.login(label) for label in ('A', 'B')}
            check(users['A'] != users['B'] and self.config['SUPABASE_PUBLISH_USER_ID'] in users.values(),
                  'authenticated identities')
            fixtures = {label: self.fixture(label, uid) for label, uid in users.items()}
            for label, uid in users.items():
                row, task = fixtures[label]
                other = fixtures['B' if label == 'A' else 'A'][0]
                self.read_report(label + ' own', self.headers(label), row, True)
                self.read_report(label + ' cross', self.headers(label), other, False)
                self.read_report(label + ' anonymous', self.public_headers, row, False, anonymous=True)
                self.denied_rpcs(label, row, task)
                self.refresh(label, uid)
        except CheckFailed as error:
            report_failure(error)
            passed = False
        except Exception:
            report_failure(CheckFailed('verification'))
            passed = False
        finally:
            for label in self.sessions:
                name = label + ' logout'
                try:
                    response = self.request(name, 'POST', '/auth/v1/logout?scope=local', self.headers(label))
                    check(response.status_code in (200, 204), name, response.status_code)
                    print(f'{name}: PASS', flush=True)
                except Exception as error:
                    report_failure(error if isinstance(error, CheckFailed) else CheckFailed(name))
                    passed = False
        return 0 if passed else 1


def main(argv=None):
    parser = SafeParser(description=__doc__)
    parser.add_argument('--env-file', required=True, help='Explicit configuration file')
    parser.add_argument('--run', action='store_true', help='Run online checks and create temporary login sessions')
    try:
        args = parser.parse_args(argv)
        config = load_config(args.env_file)
        print('configuration: PASS', flush=True)
        return Verifier(config).run() if args.run else 0
    except CheckFailed as error:
        report_failure(error)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
