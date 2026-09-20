"""Optional, platform-independent Supabase publication of existing analysis reports.

The private local package is a retry artifact, not a second cloud database. Never
retry the model to repair a publication. HTTP diagnostics deliberately omit bodies,
URLs, credentials and user data. service_role/Secret keys belong only on trusted hosts.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import copy
import hashlib
import json
import os
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID, NAMESPACE_URL, uuid4, uuid5

import requests


class PublishError(RuntimeError):
    """Publication failed; original local analysis and notifications remain valid."""


_RESULT_FIELDS = (
    'code', 'name', 'sentiment_score', 'trend_prediction', 'operation_advice',
    'analysis_summary', 'risk_warning', 'current_price', 'change_pct', 'report_language',
)


def _digest(payload: dict) -> str:
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True,
                                     separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def build_envelope(user_id: str, key: str, markdown: str, results: list[dict], *,
                   generated_at: str | None = None, market_as_of: str | None = None,
                   execution_summary: dict | None = None) -> dict:
    """Snapshot only display fields; retain stock identifiers as strings."""
    user_id = str(UUID(user_id))
    if not key.strip() or not markdown.strip():
        raise PublishError('publication key and report content are required')
    payload = {
        'title': ' / '.join(str(r.get('code', '')) for r in results) or '分析报告',
        'markdown': markdown,
        'results': [{k: r[k] for k in _RESULT_FIELDS if k in r} for r in results],
        'generated_at': generated_at or datetime.now(timezone.utc).isoformat(),
        'market_as_of': market_as_of,  # Unknown data cutoff stays unknown, not generation time.
    }
    if execution_summary is not None:
        payload['execution_summary'] = copy.deepcopy(execution_summary)
    return {
        'version': 1, 'user_id': user_id,
        'task_id': str(uuid5(NAMESPACE_URL, f'dsa-report:{user_id}:{key}')),
        'content_hash': _digest(payload), 'payload': payload,
    }


class CloudPublisher:
    """Small HTTP adapter; database RPCs own authorization and final transactions."""

    def __init__(self, config, *, session=None):
        self.url = (config.supabase_url or '').rstrip('/')
        self.key = config.supabase_secret_key or ''
        self.user_id = config.supabase_publish_user_id or ''
        self.timeout = config.supabase_publish_timeout
        if getattr(config, 'enable_actions_dispatch', False):
            raise PublishError('ENABLE_ACTIONS_DISPATCH is unsupported; keep it false')
        parsed = urlsplit(self.url)
        local_http = parsed.scheme == 'http' and parsed.hostname in ('localhost', '127.0.0.1', '::1')
        if (not self.key or not self.user_id or not parsed.hostname or
                (parsed.scheme != 'https' and not local_http) or parsed.path or parsed.query or
                parsed.fragment or parsed.username or parsed.password):
            raise PublishError('SUPABASE URL, trusted Secret Key and publish user UUID are required')
        try:
            self.user_id = str(UUID(self.user_id))
        except ValueError:
            raise PublishError('SUPABASE_PUBLISH_USER_ID must be a UUID') from None
        self.session = session or requests.Session()
        self.headers = {'apikey': self.key}
        # New sb_secret_* keys are not JWTs. Legacy service_role JWTs need Bearer.
        if self.key.startswith('eyJ'):
            self.headers['Authorization'] = f'Bearer {self.key}'

    def _request(self, method, route, *, json_body=None, data=None, upload=False):
        headers = dict(self.headers)
        if upload:
            headers.update({'Content-Type': 'text/markdown; charset=utf-8', 'x-upsert': 'false'})
        try:
            response = self.session.request(method, self.url + route, headers=headers,
                                            json=json_body, data=data, timeout=self.timeout,
                                            allow_redirects=False)
        except requests.RequestException:
            raise PublishError('publish transport failure; retry the saved package') from None
        if upload and response.status_code in (400, 409):
            try:
                body = response.json()
            except ValueError:
                body = {}
            if isinstance(body, dict) and (body.get('error') == 'Duplicate' or body.get('code') == 'Duplicate'):
                return None  # Immutable, content-addressed path; clients cannot write objects.
        if not 200 <= response.status_code < 300:
            raise PublishError(f'publish HTTP {response.status_code}; retry the saved package')
        try:
            return response.json()
        except ValueError:
            raise PublishError('publish returned invalid JSON') from None

    def _validate_envelope(self, envelope: dict) -> None:
        try:
            valid = (envelope['version'] == 1 and envelope['user_id'] == self.user_id and
                     str(UUID(envelope['task_id'])) == envelope['task_id'] and
                     envelope['content_hash'] == _digest(envelope['payload']))
        except (KeyError, ValueError, TypeError):
            valid = False
        if not valid:
            raise PublishError('invalid publication package or owner mismatch')
    def cleanup(self, envelope: dict, *, apply: bool = False) -> None:
        """Inspect by default; explicit apply cancels publication before deleting its orphan."""
        self._validate_envelope(envelope)
        args = {'p_task_id': envelope['task_id'], 'p_user_id': self.user_id,
                'p_hash': envelope['content_hash'], 'p_apply': apply}
        path = self._request('POST', '/rest/v1/rpc/cloud_cleanup_publish', json_body=args)
        expected = f"{self.user_id}/{envelope['task_id']}/{envelope['content_hash']}.md"
        if path != expected:
            raise PublishError('invalid cleanup object path')
        if apply:
            self._request('DELETE', '/storage/v1/object/analysis-reports', json_body={'prefixes': [path]})

    def publish(self, envelope: dict) -> str:
        """Retry exactly this snapshot. A succeeded task is immutable and needs no upload."""
        self._validate_envelope(envelope)
        args = {'p_task_id': envelope['task_id'], 'p_user_id': self.user_id, 'p_hash': envelope['content_hash']}
        payload = envelope['payload']
        status = self._request('POST', '/rest/v1/rpc/cloud_begin_publish', json_body={
            **args, 'p_input': {'codes': [r.get('code') for r in payload['results']]},
        })
        if status == 'succeeded':
            return status
        if status != 'publishing':
            raise PublishError('invalid publication state')
        object_path = f"{self.user_id}/{envelope['task_id']}/{envelope['content_hash']}.md"
        try:
            self._request('POST', f'/storage/v1/object/analysis-reports/{object_path}',
                          data=payload['markdown'].encode('utf-8'), upload=True)
            status = self._request('POST', '/rest/v1/rpc/cloud_complete_publish', json_body={
                **args, 'p_payload': payload, 'p_path': object_path,
            })
            if status != 'succeeded':
                raise PublishError('invalid publication completion')
            return status
        except PublishError:
            # A timeout may mean the transaction committed. SQL protects succeeded
            # from this late failure; retry begins by checking authoritative state.
            try:
                self._request('POST', '/rest/v1/rpc/cloud_fail_publish', json_body=args)
            except PublishError:
                pass  # Preserve the original explicit failure, never claim success.
            raise


def save_package(envelope: dict, directory: Path) -> Path:
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = directory / f"{envelope['task_id']}.json"
    # Exclusive creation prevents silently replacing a retry snapshot.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as handle:
        json.dump(envelope, handle, ensure_ascii=False, allow_nan=False)
    return path


def publish_completed_report(config, results, report_path: str | None, *, markdown: str | None = None) -> str | None:
    """Pipeline hook, disabled unless explicitly configured. No changes to local storage."""
    if not getattr(config, 'supabase_publish_enabled', False):
        return None
    publisher = CloudPublisher(config)
    if not report_path:
        raise PublishError('local report missing; publication was not started')
    report = Path(report_path)
    content = markdown if markdown is not None else report.read_text(encoding='utf-8')
    envelope = build_envelope(publisher.user_id, str(uuid4()), content,
                              [r.to_dict() for r in results])
    save_package(envelope, report.parent / '.cloud-publish')
    return publisher.publish(envelope)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description='Publish or retry existing reports; never runs the analysis engine')
    sub = parser.add_subparsers(dest='command', required=True)
    prepare = sub.add_parser('prepare', help='Explicit Markdown import; creates a private retry package locally')
    prepare.add_argument('--report', type=Path, required=True)
    prepare.add_argument('--user-id', required=True)
    prepare.add_argument('--key', required=True, help='Stable import key; reuse it for the same report')
    prepare.add_argument('--output-dir', type=Path, required=True)
    prepare.add_argument('--dry-run', action='store_true')
    publish = sub.add_parser('publish', help='Publish one saved package; can safely be repeated')
    publish.add_argument('package', type=Path)
    cleanup = sub.add_parser('cleanup', help='Inspect one orphan; --apply cancels its task and deletes only its attachment')
    cleanup.add_argument('package', type=Path)
    cleanup.add_argument('--apply', action='store_true', help='Irreversibly cancel this unpublished task and remove its orphan')
    args = parser.parse_args(argv)
    try:
        if args.command == 'prepare':
            envelope = build_envelope(args.user_id, args.key, args.report.read_text(encoding='utf-8'), [],
                                      generated_at=datetime.fromtimestamp(args.report.stat().st_mtime, timezone.utc).isoformat())
            if args.dry_run:
                print('Valid report; dry-run, no files written and no network requests.')
            else:
                directory = args.output_dir
                target = directory / f"{envelope['task_id']}.json"
                if target.exists():
                    if json.loads(target.read_text(encoding='utf-8')) != envelope:
                        raise PublishError('existing package differs; use its original snapshot or a new key')
                else:
                    save_package(envelope, directory)
                print(f'Package ready: {target}')
        else:
            from src.config import get_config
            config = get_config()
            # Explicit publish command requires credentials, independent of automatic hook switch.
            publisher = CloudPublisher(config)
            package = json.loads(args.package.read_text(encoding='utf-8'))
            if args.command == 'cleanup':
                publisher.cleanup(package, apply=args.apply)
                print('Orphan cleaned; publication cancelled.' if args.apply else 'Eligible unpublished attachment; dry-run, no changes.')
            else:
                print(publisher.publish(package))
        return 0
    except (PublishError, OSError, ValueError, TypeError):
        print('Publication failed. Check configuration, membership and package; retry without re-running analysis.')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
