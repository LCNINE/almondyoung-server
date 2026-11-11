#!/usr/bin/env python3
"""Prepare a minimal CodeBuild UpdateProject JSON from an administrator's current snapshot.

Does not call AWS. Keep the snapshot/output outside Git: existing environment values may be sensitive.
"""
import argparse
import copy
import json
from pathlib import Path


def prepare(project, bucket, vpc_id, subnets, security_groups):
    if project['name'] not in {f'almondyoung-deploy-{stage}' for stage in ('dev', 'demo', 'live')}:
        raise ValueError('Unexpected project')
    if project['source']['type'] != 'NO_SOURCE':
        raise ValueError('Review changed source configuration instead of overwriting it')
    if not vpc_id or not subnets or not security_groups:
        raise ValueError('Private VPC, subnets and security groups must be verified first')
    environment = copy.deepcopy(project['environment'])
    values = [value for value in environment.get('environmentVariables', [])
              if value['name'] != 'ALMONDYOUNG_DEPLOY_STORAGE_BUCKET']
    values.append({'name': 'ALMONDYOUNG_DEPLOY_STORAGE_BUCKET', 'value': bucket, 'type': 'PLAINTEXT'})
    environment['environmentVariables'] = values
    source = copy.deepcopy(project['source'])
    source['buildspec'] = Path(__file__).with_name('buildspec.yml').read_text()
    return {'name': project['name'], 'source': source, 'environment': environment,
            'concurrentBuildLimit': 1,
            'vpcConfig': {'vpcId': vpc_id, 'subnets': subnets, 'securityGroupIds': security_groups}}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', type=Path, required=True)
    parser.add_argument('--bucket', required=True)
    parser.add_argument('--vpc', required=True)
    parser.add_argument('--subnets', nargs='+', required=True)
    parser.add_argument('--security-groups', nargs='+', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    snapshot = json.loads(args.snapshot.read_text())
    projects = snapshot.get('projects', [])
    if len(projects) != 1:
        raise SystemExit('Export exactly one project per snapshot')
    result = prepare(projects[0], args.bucket, args.vpc, args.subnets, args.security_groups)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    args.output.chmod(0o600)
    print('Update file prepared. No AWS changes made.')
