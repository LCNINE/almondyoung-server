#!/usr/bin/env python3
"""Fixed CodeBuild runner; invoked from the reviewed develop checkout, never a shared PC."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile
import time

STAGES = ('dev', 'demo', 'live')
UNITS = ('auth', 'services')
ROOT = Path(__file__).resolve().parents[2]
SHA = re.compile(r'^[0-9a-f]{40}$')
WEB = ('web/auth-web', 'apps/admin-web', 'web/almondyoung-storefront', 'apps/wallet-web')


def log(step, **values):
    print(json.dumps({'step': step, **values}), flush=True)


def run(args, cwd=ROOT, capture=False):
    return subprocess.run(args, cwd=cwd, check=True, text=True,
                          stdout=subprocess.PIPE if capture else None,
                          stderr=subprocess.PIPE if capture else None).stdout


def affected_units(paths):
    affected = set()
    for path in paths:
        if path.startswith('docs/') or path.endswith('.md'):
            continue
        if path.startswith(('apps/user-service/', 'web/auth-web/', 'deployments/lcnine/auth/')):
            affected.add('auth')
        elif path.startswith(('apps/', 'web/', 'deployments/lcnine/services/')):
            affected.add('services')
        else:
            # Shared libraries, dependency manifests, infrastructure, scripts and unknown inputs.
            affected.update(UNITS)
    # Auth outputs/configuration are inputs to services.
    if 'auth' in affected:
        affected.add('services')
    return affected


def choose_units(baselines, head, changed, force=False):
    selected = set()
    for unit in UNITS:
        base = baselines.get(unit)
        if force or not isinstance(base, str) or not SHA.fullmatch(base):
            selected.add(unit)
            continue
        try:
            if unit in affected_units(changed(base, head)):
                selected.add(unit)
        except subprocess.CalledProcessError:
            selected.add(unit)  # Unavailable history must not silently skip a deployment.
    if 'auth' in selected:
        selected.add('services')
    return [unit for unit in UNITS if unit in selected]


def changed_files(base, head):
    try:
        run(['git', 'cat-file', '-e', base + '^{commit}'], capture=True)
    except subprocess.CalledProcessError:
        run(['git', 'fetch', '--depth=1', 'origin', base], capture=True)
    return run(['git', 'diff', '--name-only', '-z', base, head], capture=True).strip('\0').split('\0') if base != head else []


def get_object(bucket, key, destination):
    result = subprocess.run(['aws', 's3api', 'get-object', '--bucket', bucket, '--key', key, str(destination)],
                            text=True, capture_output=True)
    if result.returncode == 0:
        return True
    if '(NoSuchKey)' in result.stderr or '(404)' in result.stderr:
        return False
    raise RuntimeError('Deployment storage read failed; check the runner role and bucket configuration')


def put_object(bucket, key, source):
    run(['aws', 's3api', 'put-object', '--bucket', bucket, '--key', key,
         '--body', str(source), '--server-side-encryption', 'AES256'], capture=True)


def cache_paths():
    return ['.deployment-cache/npm', '.deployment-cache/yarn'] + [f'{app}/.next/cache' for app in WEB]


def cache_key(stage):
    digest = hashlib.sha256()
    files = run(['git', 'ls-files', '-z'], capture=True).split('\0')
    for name in sorted(files):
        if name and (Path(name).name in ('package-lock.json', 'yarn.lock', 'package.json') or
                     'next.config.' in name or 'open-next.config.' in name):
            digest.update(name.encode())
            digest.update((ROOT / name).read_bytes())
    # Reuse only compatible dependency/toolchain/stage caches. Cache is optional acceleration.
    for command in (['node', '--version'], ['npm', '--version'], ['yarn', '--version']):
        digest.update(run(command, capture=True).strip().encode())
    return f'cache/{stage}/linux-arm64-sst4.17.2-{digest.hexdigest()}.tar.gz'


def restore_cache(archive):
    allowed = cache_paths()
    with tarfile.open(archive, 'r:gz') as bundle:
        for member in bundle.getmembers():
            name = member.name.rstrip('/')
            if (not any(name == prefix or name.startswith(prefix + '/') for prefix in allowed)
                    or '..' in Path(name).parts or not (member.isfile() or member.isdir())):
                raise RuntimeError('Unexpected cache archive member')
        # No links, devices, absolute paths or parent traversal survived the checks above.
        for member in bundle.getmembers():
            destination = (ROOT / member.name).resolve()
            if not destination.is_relative_to(ROOT.resolve()):
                raise RuntimeError('Cache destination escapes the checkout')
            if member.isdir():
                destination.mkdir(parents=True, exist_ok=True)
            else:
                destination.parent.mkdir(parents=True, exist_ok=True)
                with bundle.extractfile(member) as source, destination.open('wb') as target:
                    import shutil
                    shutil.copyfileobj(source, target)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--stage', choices=STAGES, required=True)
    args = parser.parse_args()
    stage = args.stage
    expected = f'almondyoung-deploy-{stage}:'
    if not os.environ.get('CODEBUILD_BUILD_ID', '').startswith(expected):
        raise RuntimeError('This runner is only for the fixed AWS CodeBuild project')
    bucket = os.environ.get('ALMONDYOUNG_DEPLOY_STORAGE_BUCKET', '')
    if not re.fullmatch(r'[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]', bucket):
        raise RuntimeError('Administrator must configure the deployment storage bucket first')
    if json.loads((ROOT / 'package.json').read_text())['dependencies']['sst'] != '4.17.2':
        raise RuntimeError('Review the pipeline before changing SST version')
    head = run(['git', 'rev-parse', 'HEAD'], capture=True).strip()
    if not SHA.fullmatch(head):
        raise RuntimeError('Invalid source commit')
    os.environ.update({'CI': 'true', 'SST_STAGE': stage, 'AWS_REGION': 'ap-northeast-2',
                       'npm_config_cache': str(ROOT / '.deployment-cache/npm'),
                       'YARN_CACHE_FOLDER': str(ROOT / '.deployment-cache/yarn'),
                       'PATH': str(ROOT / 'node_modules/.bin') + os.pathsep + os.environ.get('PATH', '')})
    state_key = f'success/{stage}.json'
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix='almondyoung-pipeline-') as temporary:
        state_file = Path(temporary) / 'success.json'
        baselines = {}
        if get_object(bucket, state_key, state_file):
            state = json.loads(state_file.read_text())
            if state.get('stage') != stage or state.get('version') != 2:
                raise RuntimeError('Unexpected deployment baseline format')
            baselines = state['units']
            if not isinstance(baselines, dict) or set(baselines) - set(UNITS):
                raise RuntimeError('Unexpected deployment baseline units')
        units = choose_units(baselines, head, changed_files, os.environ.get('ALMONDYOUNG_FORCE_FULL') == 'true')
        log('plan', version=2, stage=stage, commit=head, units=units, baselines=baselines)
        key = cache_key(stage)
        archive = Path(temporary) / 'cache.tar.gz'
        hit = get_object(bucket, key, archive)
        if hit:
            restore_cache(archive)
        log('cache', status='restored' if hit else 'miss', note='archive restoration does not prove compiler cache hits')
        step_start = time.monotonic()
        run(['yarn', 'install', '--frozen-lockfile', '--non-interactive'])
        log('dependencies', seconds=round(time.monotonic() - step_start, 1))

        # Always check BOTH deployments, even when all application inputs are unchanged.
        # Requires the CodeBuild runner's VPC path to the existing private databases.
        for unit in UNITS:
            step_start = time.monotonic()
            run(['node_modules/.bin/tsx', 'scripts/deployment/migrate.ts', '--stage', stage,
                 '--deployment', f'lcnine-{unit}'])
            log('migrations', unit=unit, status='succeeded', seconds=round(time.monotonic() - step_start, 1))

        for unit in units:
            apps = WEB[:1] if unit == 'auth' else (WEB[1:2] if stage == 'demo' else WEB[1:])
            for app in apps:
                run(['npm', 'ci', '--prefix', app, '--no-audit', '--no-fund'])
            step_start = time.monotonic()
            run([str(ROOT / 'node_modules/.bin/sst'), 'deploy', '--stage', stage], ROOT / f'deployments/lcnine/{unit}')
            baselines[unit] = head
            state_file.write_text(json.dumps({'version': 2, 'stage': stage, 'units': baselines}) + '\n')
            put_object(bucket, state_key, state_file)
            log('deploy', unit=unit, status='succeeded', seconds=round(time.monotonic() - step_start, 1))

        with tarfile.open(archive, 'w:gz') as bundle:
            for name in cache_paths():
                if (ROOT / name).exists():
                    bundle.add(ROOT / name, arcname=name, recursive=True,
                               filter=lambda entry: entry if entry.isfile() or entry.isdir() else None)
        try:
            put_object(bucket, key, archive)
            log('cache', status='saved')
        except subprocess.CalledProcessError:
            log('cache', status='save-failed', note='deployments succeeded; the next build may need a cold cache')
        log('complete', commit=head, stage=stage, seconds=round(time.monotonic() - started, 1))


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError, ValueError, OSError) as error:
        # Avoid printing captured AWS/DB output or environment variables.
        print(f'Pipeline stopped: {error if isinstance(error, RuntimeError) else type(error).__name__}', flush=True)
        raise SystemExit(1)
