#!/usr/bin/env python3
"""Invoke the fixed almondyoung deployment gateway using AWS CLI v2."""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import uuid


def invoke(payload, profile):
    with tempfile.TemporaryDirectory(prefix="almondyoung-deploy-") as directory:
        response_path = os.path.join(directory, "response.json")
        result = subprocess.run([
            "aws", "--profile", profile, "--region", "ap-northeast-2",
            "lambda", "invoke", "--function-name", "almondyoung-deploy-control",
            "--cli-binary-format", "raw-in-base64-out", "--payload", json.dumps(payload),
            "--output", "json", "--no-cli-pager", response_path,
        ], text=True, capture_output=True, check=False)
        if result.returncode:
            raise RuntimeError(result.stderr.strip())
        metadata = json.loads(result.stdout)
        with open(response_path, encoding="utf-8") as response_file:
            response = json.load(response_file)
        if metadata.get("FunctionError"):
            raise RuntimeError(response.get("errorMessage", "Deployment gateway failed"))
        return response


def require_pipeline_v2(response):
    if response.get("pipelineVersion") != 2 or response.get("ready") is not True:
        raise RuntimeError("AWS 배포 파이프라인 v2 연결이 완료되지 않았습니다. 관리자에게 deployments/ci/README.md의 적용 절차를 요청하세요. 배포는 시작하지 않았습니다.")


def main():
    parser = argparse.ArgumentParser(description="almondyoung-server 지정 배포 실행/상태 확인")
    parser.add_argument("action", choices=("check", "validate", "deploy", "status"))
    parser.add_argument("stage", choices=("dev", "demo", "live"))
    parser.add_argument("build_id", nargs="?")
    parser.add_argument("--profile", default="lcnine-public")
    parser.add_argument("--force-full", action="store_true", help="변경 감지를 무시하고 두 스택 배포 (마이그레이션 검사는 유지)")
    args = parser.parse_args()
    if args.action == "status" and not args.build_id:
        parser.error("status에는 배포 실행 후 받은 buildId가 필요합니다.")
    if args.action != "status" and args.build_id:
        parser.error("buildId는 status에서만 입력합니다.")
    if args.force_full and args.action != "deploy":
        parser.error("--force-full은 deploy에서만 입력합니다.")
    payload = {"action": args.action, "stage": args.stage}
    if args.action in ("deploy", "validate"):
        payload["requestId"] = str(uuid.uuid4())
        if args.force_full:
            payload["forceFull"] = True
    elif args.action == "status":
        payload["buildId"] = args.build_id
    try:
        if args.action == "deploy":
            require_pipeline_v2(invoke({"action": "check", "stage": args.stage}, args.profile))
        response = invoke(payload, args.profile)
        print(json.dumps(response, ensure_ascii=False, indent=2))
        if args.action == "check":
            require_pipeline_v2(response)
        return 0
    except (RuntimeError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1
    except FileNotFoundError:
        print("AWS CLI v2를 설치한 후 다시 실행하세요.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
