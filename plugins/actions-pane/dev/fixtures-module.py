"""Prints src/testing/gh-fixtures.ts from captured gh JSON (see capture-fixtures.sh)."""
import json
import sys

src, repo = sys.argv[1], sys.argv[2]


def load(name):
    with open(f"{src}/{name}.json") as f:
        return json.load(f)


def trim_steps(steps):
    """Long step lists trimmed around the step in progress, keeping its shape."""
    if len(steps) <= 12:
        return steps
    current = next((i for i, s in enumerate(steps) if s["status"] != "completed"), len(steps) - 1)
    keep = set(range(3)) | set(range(max(0, current - 2), min(len(steps), current + 4))) | {len(steps) - 1}
    return [s for i, s in enumerate(steps) if i in keep]


inprog = load("inprog")
for job in inprog["jobs"]:
    job["steps"] = trim_steps(job["steps"])


def lit(data):
    text = json.dumps(data, indent=2, ensure_ascii=False)
    return "`" + text.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${") + "`"


out = [
    f"// Real `gh` output captured from {repo} (read-only `gh run list` and",
    "// `gh run view --json jobs`), long step lists trimmed; regenerate with",
    "// dev/capture-fixtures.sh. Note the shapes: `conclusion: \"\"` before a run or",
    "// job completes, and `0001-01-01T00:00:00Z` for a time not reached yet.",
    "",
]
for name, doc, data in [
    ("RUN_LIST", "`gh run list --limit 6 --json …`: newest first.", load("list")),
    ("JOBS_LINT_FAILED", "`gh run view --json jobs` of a completed run: one job passed, one failed at a step.", load("failed")),
    ("JOBS_IN_PROGRESS", "`gh run view --json jobs` mid-run: two jobs done, one in progress with pending steps.", inprog),
    ("JOBS_NONE", "`gh run view --json jobs` of a run that failed before any job started.", load("nojobs")),
]:
    out += [f"/** {doc} */", f"export const {name} = {lit(data)}", ""]
print("\n".join(out).rstrip())
