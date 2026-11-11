#!/usr/bin/env python3
"""Invoke the fixed almondyoung deployment gateway using AWS CLI v2."""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import uuid


def main():
    parser = argparse.ArgumentParser(description="almondyoung-server 지정 배포 실행/상태 확인")
    parser.add_argument("action", choices=("check", "deploy", "status"))
    parser.add_argument("stage", choices=("dev", "demo", "live"))
    parser.add_argument("build_id", nargs="?")
    parser.add_argument("--profile", default="lcnine-public")
    args = parser.parse_args()
    if args.action == "status" and not args.build_id:
        parser.error("status에는 배포 실행 후 받은 buildId가 필요합니다.")
    if args.action != "status" and args.build_id:
        parser.error("buildId는 status에서만 입력합니다.")
    payload = {"action": args.action, "stage": args.stage}
    if args.action == "deploy":
        payload["requestId"] = str(uuid.uuid4())
    elif args.action == "status":
        payload["buildId"] = args.build_id
    try:
        with tempfile.TemporaryDirectory(prefix="almondyoung-deploy-") as directory:
            response_path = os.path.join(directory, "response.json")
            command = [
                "aws", "--profile", args.profile, "--region", "ap-northeast-2",
                "lambda", "invoke", "--function-name", "almondyoung-deploy-control",
                "--cli-binary-format", "raw-in-base64-out", "--payload", json.dumps(payload),
                "--output", "json", "--no-cli-pager", response_path,
            ]
            result = subprocess.run(command, text=True, capture_output=True, check=False)
            if result.returncode:
                print(result.stderr.strip(), file=sys.stderr)
                return result.returncode
            metadata = json.loads(result.stdout)
            with open(response_path, encoding="utf-8") as response_file:
                response = json.load(response_file)
            print(json.dumps(response, ensure_ascii=False, indent=2))
            return 1 if metadata.get("FunctionError") else 0
    except FileNotFoundError:
        print("AWS CLI v2를 설치한 후 다시 실행하세요.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
