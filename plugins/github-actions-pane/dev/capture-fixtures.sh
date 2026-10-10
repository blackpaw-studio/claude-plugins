#!/usr/bin/env bash
# Captures the real gh JSON shapes behind src/testing/gh-fixtures.ts from a
# public repo with read-only calls (`gh run list`, `gh run view --json jobs`)
# and prints the fixture module. Run IDs age out; pick fresh ones with
#   gh run list -R cli/cli --limit 100 --json databaseId,status,conclusion
# Usage: dev/capture-fixtures.sh <repo> <in-progress run> <failed run> <failed-no-jobs run> > src/testing/gh-fixtures.ts
set -euo pipefail
repo=${1:?repo} inprog=${2:?in-progress run id} failed=${3:?failed run id} nojobs=${4:?failed run with no jobs}
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
fields=databaseId,number,workflowName,displayTitle,event,status,conclusion,headBranch,headSha,createdAt,startedAt,updatedAt,url,workflowDatabaseId
gh run list -R "$repo" --limit 6 --json "$fields" > "$dir/list.json"
workflow=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[0]["workflowDatabaseId"])' "$dir/list.json")
gh run list -R "$repo" --workflow "$workflow" --status success --limit 10 --json startedAt,createdAt,updatedAt,conclusion > "$dir/history.json"
gh run view "$inprog" -R "$repo" --json jobs > "$dir/inprog.json"
gh run view "$failed" -R "$repo" --json jobs > "$dir/failed.json"
gh run view "$nojobs" -R "$repo" --json jobs > "$dir/nojobs.json"
python3 "$(dirname "$0")/fixtures-module.py" "$dir" "$repo"
