"""Fixed deployment gateway. Callers cannot provide commands, source, or AWS overrides."""
import os
import re
import boto3

PROJECTS = {stage: f'almondyoung-deploy-{stage}' for stage in ('dev', 'demo', 'live')}
UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
client = boto3.client('codebuild', region_name='ap-northeast-2')


def pipeline_ready(stage):
    # Set only after the administrator installs buildspec v2, storage and private DB connectivity.
    return stage in os.environ.get('PIPELINE_V2_READY_STAGES', '').split(',')


def handler(event, context):
    if not isinstance(event, dict):
        raise ValueError('Expected a JSON object')
    action = event.get('action')
    stage = event.get('stage')
    if stage not in PROJECTS or action not in ('deploy', 'validate', 'status', 'check'):
        raise ValueError('Allowed stages: dev, demo, live. Allowed actions: deploy, validate, status, check.')
    project = PROJECTS[stage]
    if action == 'check':
        if set(event) != {'action', 'stage'}:
            raise ValueError('Unexpected input')
        return {'stage': stage, 'repository': 'LCNINE/almondyoung-server', 'branch': 'develop',
                'ready': pipeline_ready(stage), 'pipelineVersion': 2,
                'installed': stage in os.environ.get('PIPELINE_V2_INSTALLED_STAGES', '').split(','),
                'drizzleMigrations': 'predeploy', 'medusaMigrations': 'admin-container-start'}
    if action in ('deploy', 'validate'):
        if set(event) not in ({'action', 'stage', 'requestId'}, {'action', 'stage', 'requestId', 'forceFull'}) or not isinstance(event['requestId'], str) or not UUID.fullmatch(event['requestId']):
            raise ValueError('deploy requires a UUID requestId and optional boolean forceFull')
        if type(event.get('forceFull', False)) is not bool:
            raise ValueError('forceFull must be boolean')
        if action == 'validate' and 'forceFull' in event:
            raise ValueError('validate does not accept forceFull')
        if stage not in os.environ.get('PIPELINE_V2_INSTALLED_STAGES', '').split(','):
            raise RuntimeError('Pipeline v2 build configuration is not installed for this stage')
        if action == 'deploy' and not pipeline_ready(stage):
            raise RuntimeError('Pipeline v2 is not configured for this stage')
        # The caller selects only this boolean, never an arbitrary environment variable or command.
        build = client.start_build(projectName=project, idempotencyToken=event['requestId'],
            environmentVariablesOverride=[{'name': 'ALMONDYOUNG_FORCE_FULL',
                'value': 'true' if event.get('forceFull', False) else 'false', 'type': 'PLAINTEXT'},
                {'name': 'ALMONDYOUNG_VALIDATE_ONLY', 'value': 'true' if action == 'validate' else 'false', 'type': 'PLAINTEXT'}])['build']
    else:
        if set(event) != {'action', 'stage', 'buildId'} or not isinstance(event['buildId'], str):
            raise ValueError('status requires buildId and no other fields')
        prefix, separator, suffix = event['buildId'].partition(':')
        if prefix != project or not separator or not UUID.fullmatch(suffix):
            raise ValueError('buildId does not belong to this stage')
        builds = client.batch_get_builds(ids=[event['buildId']]).get('builds', [])
        if len(builds) != 1:
            raise ValueError('Build not found')
        build = builds[0]
    if build.get('projectName') != project or not str(build.get('id', '')).startswith(project + ':'):
        raise RuntimeError('Unexpected build response')
    # Never return environment variables, source credentials, logs, or raw AWS response.
    return {'stage': stage, 'buildId': build['id'], 'status': build.get('buildStatus', 'UNKNOWN'),
            'phase': build.get('currentPhase', 'UNKNOWN'), 'complete': bool(build.get('buildComplete', False))}
