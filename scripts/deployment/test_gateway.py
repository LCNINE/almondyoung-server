import importlib.util
import os
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
client = Mock()
with patch.dict(sys.modules, {'boto3': SimpleNamespace(client=lambda *a, **kw: client)}):
    spec = importlib.util.spec_from_file_location('gateway', ROOT / 'deployments/ci/deploy_control.py')
    gateway = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gateway)
spec = importlib.util.spec_from_file_location('deploy_client', ROOT / 'scripts/almondyoung-deploy.py')
deploy_client = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy_client)
spec = importlib.util.spec_from_file_location('prepare_update', ROOT / 'deployments/ci/prepare_project_update.py')
prepare_update = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare_update)
REQUEST = '11111111-1111-4111-8111-111111111111'


class GatewayTest(unittest.TestCase):
    def setUp(self):
        client.reset_mock()
        client.start_build.return_value = {'build': {'projectName': 'almondyoung-deploy-live',
            'id': 'almondyoung-deploy-live:' + REQUEST, 'buildStatus': 'IN_PROGRESS'}}

    def test_legacy_or_unready_pipeline_is_not_reported_as_migration_enabled(self):
        for response in ({'ready': True}, {'pipelineVersion': 2, 'ready': False}):
            with self.assertRaises(RuntimeError):
                deploy_client.require_pipeline_v2(response)
        deploy_client.require_pipeline_v2({'pipelineVersion': 2, 'ready': True})

    def test_unconfigured_gateway_never_starts_build(self):
        with patch.dict(os.environ, {'PIPELINE_V2_READY_STAGES': ''}):
            with self.assertRaises(RuntimeError):
                gateway.handler({'action': 'deploy', 'stage': 'live', 'requestId': REQUEST}, None)
        client.start_build.assert_not_called()

    def test_only_boolean_force_full_override_is_accepted(self):
        with patch.dict(os.environ, {'PIPELINE_V2_READY_STAGES': 'live'}):
            gateway.handler({'action': 'deploy', 'stage': 'live', 'requestId': REQUEST, 'forceFull': True}, None)
        values = client.start_build.call_args.kwargs
        self.assertEqual(values['projectName'], 'almondyoung-deploy-live')
        self.assertEqual(values['environmentVariablesOverride'],
                         [{'name': 'ALMONDYOUNG_FORCE_FULL', 'value': 'true', 'type': 'PLAINTEXT'}])

    def test_source_commands_and_arbitrary_environment_overrides_are_rejected(self):
        for extra in ({'sourceVersion': 'other'}, {'buildspecOverride': 'evil'}, {'forceFull': 'true'},
                      {'environmentVariablesOverride': []}):
            with patch.dict(os.environ, {'PIPELINE_V2_READY_STAGES': 'live'}):
                with self.assertRaises(ValueError):
                    gateway.handler({'action': 'deploy', 'stage': 'live', 'requestId': REQUEST, **extra}, None)
        client.start_build.assert_not_called()

    def test_new_client_does_not_deploy_through_old_gateway(self):
        with patch.object(deploy_client, 'invoke', return_value={'ready': True}) as invoke:
            with patch.object(sys, 'argv', ['deploy.py', 'deploy', 'live']):
                self.assertEqual(deploy_client.main(), 1)
        self.assertEqual(invoke.call_count, 1)
        self.assertEqual(invoke.call_args.args[0]['action'], 'check')

    def test_project_update_preserves_existing_environment_and_requires_network(self):
        project = {'name': 'almondyoung-deploy-live', 'source': {'type': 'NO_SOURCE', 'buildspec': 'old'},
                   'environment': {'type': 'ARM_CONTAINER', 'image': 'existing-image', 'privilegedMode': True,
                                   'environmentVariables': [{'name': 'KEEP', 'value': 'value', 'type': 'PLAINTEXT'}]}}
        update = prepare_update.prepare(project, 'test-bucket', 'vpc-known', ['subnet-private'], ['sg-build'])
        self.assertEqual(update['environment']['image'], 'existing-image')
        self.assertEqual(update['environment']['environmentVariables'][0]['name'], 'KEEP')
        self.assertEqual(project['source']['buildspec'], 'old')
        self.assertNotIn('serviceRole', update)
        with self.assertRaises(ValueError):
            prepare_update.prepare(project, 'test-bucket', '', [], [])


if __name__ == '__main__':
    unittest.main()
