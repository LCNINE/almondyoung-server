import importlib.util
from pathlib import Path
import subprocess
import os
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('pipeline', Path(__file__).with_name('pipeline.py'))
pipeline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pipeline)
A = 'a' * 40
B = 'b' * 40
C = 'c' * 40


class PipelineTest(unittest.TestCase):
    def test_storefront_skips_auth(self):
        self.assertEqual(pipeline.choose_units({'auth': A, 'services': A}, B,
                         lambda *_: ['web/almondyoung-storefront/src/page.tsx']), ['services'])

    def test_shared_code_and_auth_propagate(self):
        for name in ('libs/shared/src/index.ts', 'package-lock.json', 'deployments/lcnine/stage.ts',
                     'apps/user-service/src/main.ts', 'unknown-config.json'):
            self.assertEqual(pipeline.affected_units([name]), {'auth', 'services'})

    def test_documents_do_not_redeploy(self):
        self.assertEqual(pipeline.choose_units({'auth': A, 'services': A}, B,
                         lambda *_: ['docs/runbooks/lcnine-public-deployment.md']), [])

    def test_missing_history_falls_back_to_full(self):
        def unavailable(*_):
            raise subprocess.CalledProcessError(1, 'git')
        self.assertEqual(pipeline.choose_units({}, B, unavailable), ['auth', 'services'])
        self.assertEqual(pipeline.choose_units({'auth': A, 'services': A}, B, unavailable), ['auth', 'services'])

    def test_each_unit_uses_its_own_last_success(self):
        compared = []
        def changed(base, head):
            compared.append((base, head))
            return [] if base == B else ['apps/core/src/main.ts']
        self.assertEqual(pipeline.choose_units({'auth': B, 'services': A}, C, changed), ['services'])
        self.assertEqual(compared, [(B, C), (A, C)])

    def test_force_full_even_when_unchanged(self):
        self.assertEqual(pipeline.choose_units({'auth': A, 'services': A}, A, lambda *_: [], True), ['auth', 'services'])

    def test_migration_failure_prevents_every_deploy_and_success_write(self):
        commands = []
        def run(command, *args, **kwargs):
            commands.append(command)
            if command[:2] == ['git', 'rev-parse']:
                return A
            if 'scripts/deployment/migrate.ts' in command:
                raise subprocess.CalledProcessError(1, command)
            return ''
        with patch.dict(os.environ, {'CODEBUILD_BUILD_ID': 'almondyoung-deploy-live:test',
                                     'ALMONDYOUNG_DEPLOY_STORAGE_BUCKET': 'test-deployment-storage'}):
            with patch.object(sys, 'argv', ['pipeline.py', '--stage', 'live']):
                with patch.object(pipeline, 'run', side_effect=run), \
                     patch.object(pipeline, 'cache_key', return_value='cache/live/test'), \
                     patch.object(pipeline, 'get_object', return_value=False), \
                     patch.object(pipeline, 'put_object') as write:
                    with self.assertRaises(subprocess.CalledProcessError):
                        pipeline.main()
                    write.assert_not_called()
        self.assertFalse(any('deploy' in command for command in commands))

    def test_unchanged_apps_still_check_both_migration_scopes(self):
        commands = []
        def read(bucket, key, destination):
            if key.startswith('success/'):
                destination.write_text('{"version":2,"stage":"live","units":{"auth":"' + A + '","services":"' + A + '"}}')
                return True
            return False
        def run(command, *args, **kwargs):
            commands.append(command)
            return A if command[:2] == ['git', 'rev-parse'] else ''
        with patch.dict(os.environ, {'CODEBUILD_BUILD_ID': 'almondyoung-deploy-live:test',
                                     'ALMONDYOUNG_DEPLOY_STORAGE_BUCKET': 'test-deployment-storage',
                                     'ALMONDYOUNG_FORCE_FULL': 'false'}):
            with patch.object(sys, 'argv', ['pipeline.py', '--stage', 'live']):
                with patch.object(pipeline, 'run', side_effect=run), \
                     patch.object(pipeline, 'cache_key', return_value='cache/live/test'), \
                     patch.object(pipeline, 'get_object', side_effect=read), \
                     patch.object(pipeline, 'cache_paths', return_value=[]), \
                     patch.object(pipeline, 'put_object'):
                    pipeline.main()
        migrations = [command[-1] for command in commands if 'scripts/deployment/migrate.ts' in command]
        self.assertEqual(migrations, ['lcnine-auth', 'lcnine-services'])
        self.assertFalse(any('deploy' in command for command in commands))

    def test_cache_rejects_symlinks_and_path_traversal(self):
        for name, kind in [('.deployment-cache/npm/../../escape', tarfile.REGTYPE),
                           ('.deployment-cache/npm/link', tarfile.SYMTYPE)]:
            with tempfile.TemporaryDirectory() as directory:
                archive = Path(directory) / 'cache.tar.gz'
                with tarfile.open(archive, 'w:gz') as bundle:
                    member = tarfile.TarInfo(name)
                    member.type = kind
                    bundle.addfile(member)
                with self.assertRaises(RuntimeError):
                    pipeline.restore_cache(archive)


if __name__ == '__main__':
    unittest.main()
