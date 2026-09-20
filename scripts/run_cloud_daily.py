"""Run one deterministic GitHub Actions cloud daily task."""
from __future__ import annotations

import argparse
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timezone
import logging
import os
import sys
from pathlib import Path


# Executing a script path does not add the repository root to sys.path.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description='Run the A-account cloud daily analysis')
    parser.add_argument('--force-run', action='store_true', help='skip the trading-day check')
    args = parser.parse_args(argv)

    os.umask(0o077)
    log_dir = Path(os.getenv('LOG_DIR', 'logs'))
    log_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    log_path = log_dir / 'cloud-daily.log'
    with log_path.open('a', encoding='utf-8') as log_file:
        log_path.chmod(0o600)
        with redirect_stdout(log_file), redirect_stderr(log_file):
            logging.basicConfig(
                level=logging.INFO,
                format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
                handlers=[logging.StreamHandler(log_file)],
                force=True,
            )
            logging.info('cloud daily started at %s', datetime.now(timezone.utc).isoformat())
            try:
                from src.config import get_config
                config = get_config()
                # Load the service only after output has been redirected: model
                # providers may emit diagnostics while importing.
                from src.services.cloud_daily import run_cloud_daily
                result = run_cloud_daily(config, force_run=args.force_run)
            except Exception:
                logging.exception('cloud daily failed')
                result = 1
            logging.info('cloud daily finished with status=%s', result)
    if result == 0:
        print('Cloud daily completed or skipped.')
    else:
        print('Cloud daily failed; inspect the private runner log.')
    return result


if __name__ == '__main__':
    raise SystemExit(main())
