// Real `gh` output captured from cli/cli (read-only `gh run list` and
// `gh run view --json jobs`), long step lists trimmed; regenerate with
// dev/capture-fixtures.sh. Note the shapes: `conclusion: ""` before a run or
// job completes, and `0001-01-01T00:00:00Z` for a time not reached yet.

/** `gh run list --limit 6 --json …`: newest first, the newest still queued. */
export const RUN_LIST = `[
  {
    "conclusion": "",
    "createdAt": "2026-10-10T02:02:00Z",
    "databaseId": 38015447143,
    "displayTitle": "Dependabot PR Triage (skills-driven)",
    "event": "schedule",
    "headBranch": "trunk",
    "headSha": "ec5b512045db67e5a2a4ff4a1b02660b2fb24390",
    "number": 1637,
    "startedAt": "2026-10-10T02:02:00Z",
    "status": "queued",
    "updatedAt": "2026-10-10T02:03:35Z",
    "url": "https://github.com/cli/cli/actions/runs/38015447143",
    "workflowName": "Dependabot PR Triage (skills-driven)"
  },
  {
    "conclusion": "success",
    "createdAt": "2026-10-10T01:41:10Z",
    "databaseId": 38014126493,
    "displayTitle": "Triage Scheduled Tasks",
    "event": "schedule",
    "headBranch": "trunk",
    "headSha": "ec5b512045db67e5a2a4ff4a1b02660b2fb24390",
    "number": 8052,
    "startedAt": "2026-10-10T01:41:10Z",
    "status": "completed",
    "updatedAt": "2026-10-10T01:41:21Z",
    "url": "https://github.com/cli/cli/actions/runs/38014126493",
    "workflowName": "Triage Scheduled Tasks"
  },
  {
    "conclusion": "success",
    "createdAt": "2026-10-10T01:19:01Z",
    "databaseId": 38012701370,
    "displayTitle": "Dependabot PR Triage (skills-driven)",
    "event": "schedule",
    "headBranch": "trunk",
    "headSha": "ec5b512045db67e5a2a4ff4a1b02660b2fb24390",
    "number": 1636,
    "startedAt": "2026-10-10T01:19:01Z",
    "status": "completed",
    "updatedAt": "2026-10-10T01:22:34Z",
    "url": "https://github.com/cli/cli/actions/runs/38012701370",
    "workflowName": "Dependabot PR Triage (skills-driven)"
  },
  {
    "conclusion": "success",
    "createdAt": "2026-10-10T01:18:01Z",
    "databaseId": 38012637328,
    "displayTitle": "Agentic Maintenance",
    "event": "schedule",
    "headBranch": "trunk",
    "headSha": "ec5b512045db67e5a2a4ff4a1b02660b2fb24390",
    "number": 78,
    "startedAt": "2026-10-10T01:18:01Z",
    "status": "completed",
    "updatedAt": "2026-10-10T01:18:28Z",
    "url": "https://github.com/cli/cli/actions/runs/38012637328",
    "workflowName": "Agentic Maintenance"
  },
  {
    "conclusion": "success",
    "createdAt": "2026-10-10T01:00:29Z",
    "databaseId": 38011438812,
    "displayTitle": "Triage Scheduled Tasks",
    "event": "schedule",
    "headBranch": "trunk",
    "headSha": "ec5b512045db67e5a2a4ff4a1b02660b2fb24390",
    "number": 8050,
    "startedAt": "2026-10-10T01:00:29Z",
    "status": "completed",
    "updatedAt": "2026-10-10T01:00:41Z",
    "url": "https://github.com/cli/cli/actions/runs/38011438812",
    "workflowName": "Triage Scheduled Tasks"
  },
  {
    "conclusion": "success",
    "createdAt": "2026-10-10T00:58:25Z",
    "databaseId": 38011291519,
    "displayTitle": "\`--attach\` cannot work for GitHub App installation tokens — the upload endpoint 404s them even with write access",
    "event": "issue_comment",
    "headBranch": "trunk",
    "headSha": "ec5b512045db67e5a2a4ff4a1b02660b2fb24390",
    "number": 8049,
    "startedAt": "2026-10-10T00:58:25Z",
    "status": "completed",
    "updatedAt": "2026-10-10T00:58:33Z",
    "url": "https://github.com/cli/cli/actions/runs/38011291519",
    "workflowName": "Triage Scheduled Tasks"
  }
]`

/** `gh run view --json jobs` of a completed run: one job passed, one failed at a step. */
export const JOBS_LINT_FAILED = `{
  "jobs": [
    {
      "completedAt": "2026-10-09T19:42:33Z",
      "conclusion": "success",
      "databaseId": 113993699722,
      "name": "lint",
      "startedAt": "2026-10-09T19:39:50Z",
      "status": "completed",
      "steps": [
        {
          "completedAt": "2026-10-09T19:39:52Z",
          "conclusion": "success",
          "name": "Set up job",
          "number": 1,
          "startedAt": "2026-10-09T19:39:51Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-10-09T19:39:54Z",
          "conclusion": "success",
          "name": "Check out code",
          "number": 2,
          "startedAt": "2026-10-09T19:39:52Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-10-09T19:40:10Z",
          "conclusion": "success",
          "name": "Set up Go",
          "number": 3,
          "startedAt": "2026-10-09T19:39:54Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-10-09T19:41:14Z",
          "conclusion": "success",
          "name": "Ensure Go source and modules are up to date",
          "number": 4,
          "startedAt": "2026-10-09T19:40:10Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-10-09T19:41:44Z",
          "conclusion": "success",
          "name": "golangci-lint",
          "number": 5,
          "startedAt": "2026-10-09T19:41:14Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-10-09T19:42:27Z",
          "conclusion": "success",
          "name": "Verify license generation",
          "number": 6,
          "startedAt": "2026-10-09T19:41:44Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-10-09T19:42:29Z",
          "conclusion": "success",
          "name": "Post golangci-lint",
          "number": 10,
          "startedAt": "2026-10-09T19:42:27Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-10-09T19:42:29Z",
          "conclusion": "success",
          "name": "Post Set up Go",
          "number": 11,
          "startedAt": "2026-10-09T19:42:29Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-10-09T19:42:30Z",
          "conclusion": "success",
          "name": "Post Check out code",
          "number": 12,
          "startedAt": "2026-10-09T19:42:29Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-10-09T19:42:30Z",
          "conclusion": "success",
          "name": "Complete job",
          "number": 13,
          "startedAt": "2026-10-09T19:42:30Z",
          "status": "completed"
        }
      ],
      "url": "https://github.com/cli/cli/actions/runs/37981739982/job/113993699722"
    },
    {
      "completedAt": "2026-10-09T19:40:22Z",
      "conclusion": "failure",
      "databaseId": 113993700082,
      "name": "govulncheck",
      "startedAt": "2026-10-09T19:39:49Z",
      "status": "completed",
      "steps": [
        {
          "completedAt": "2026-10-09T19:39:51Z",
          "conclusion": "success",
          "name": "Set up job",
          "number": 1,
          "startedAt": "2026-10-09T19:39:50Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-10-09T19:39:53Z",
          "conclusion": "success",
          "name": "Check out code",
          "number": 2,
          "startedAt": "2026-10-09T19:39:51Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-10-09T19:40:07Z",
          "conclusion": "success",
          "name": "Set up Go",
          "number": 3,
          "startedAt": "2026-10-09T19:39:53Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-10-09T19:40:19Z",
          "conclusion": "failure",
          "name": "Check Go vulnerabilities",
          "number": 4,
          "startedAt": "2026-10-09T19:40:07Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-10-09T19:40:19Z",
          "conclusion": "skipped",
          "name": "Post Set up Go",
          "number": 7,
          "startedAt": "2026-10-09T19:40:19Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-10-09T19:40:19Z",
          "conclusion": "success",
          "name": "Post Check out code",
          "number": 8,
          "startedAt": "2026-10-09T19:40:19Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-10-09T19:40:19Z",
          "conclusion": "success",
          "name": "Complete job",
          "number": 9,
          "startedAt": "2026-10-09T19:40:19Z",
          "status": "completed"
        }
      ],
      "url": "https://github.com/cli/cli/actions/runs/37981739982/job/113993700082"
    }
  ]
}`

/** `gh run view --json jobs` mid-run: two jobs done, one in progress with pending steps. */
export const JOBS_IN_PROGRESS = `{
  "jobs": [
    {
      "completedAt": "2026-10-10T02:02:36Z",
      "conclusion": "success",
      "databaseId": 114104571211,
      "name": "activation",
      "startedAt": "2026-10-10T02:02:05Z",
      "status": "completed",
      "steps": [
        {
          "completedAt": "2026-10-10T02:02:11Z",
          "conclusion": "success",
          "name": "Set up job",
          "number": 1,
          "startedAt": "2026-10-10T02:02:07Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-10-10T02:02:16Z",
          "conclusion": "success",
          "name": "Setup Scripts",
          "number": 2,
          "startedAt": "2026-10-10T02:02:11Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-10-10T02:02:17Z",
          "conclusion": "success",
          "name": "Generate agentic run info",
          "number": 3,
          "startedAt": "2026-10-10T02:02:16Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-10-10T02:02:34Z",
          "conclusion": "success",
          "name": "Post Checkout .github and .agents folders",
          "number": 37,
          "startedAt": "2026-10-10T02:02:34Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-10-10T02:02:34Z",
          "conclusion": "success",
          "name": "Post Setup Scripts",
          "number": 38,
          "startedAt": "2026-10-10T02:02:34Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-10-10T02:02:34Z",
          "conclusion": "success",
          "name": "Complete job",
          "number": 39,
          "startedAt": "2026-10-10T02:02:34Z",
          "status": "completed"
        }
      ],
      "url": "https://github.com/cli/cli/actions/runs/38015447143/job/114104571211"
    },
    {
      "completedAt": "2026-10-10T02:03:34Z",
      "conclusion": "success",
      "databaseId": 114104688493,
      "name": "agent",
      "startedAt": "2026-10-10T02:02:39Z",
      "status": "completed",
      "steps": [
        {
          "completedAt": "2026-10-10T02:02:41Z",
          "conclusion": "success",
          "name": "Set up job",
          "number": 1,
          "startedAt": "2026-10-10T02:02:40Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-10-10T02:02:43Z",
          "conclusion": "success",
          "name": "Setup Scripts",
          "number": 2,
          "startedAt": "2026-10-10T02:02:41Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-10-10T02:02:43Z",
          "conclusion": "success",
          "name": "Set runtime paths",
          "number": 3,
          "startedAt": "2026-10-10T02:02:43Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-10-10T02:03:33Z",
          "conclusion": "success",
          "name": "Post Checkout repository",
          "number": 89,
          "startedAt": "2026-10-10T02:03:33Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-10-10T02:03:33Z",
          "conclusion": "success",
          "name": "Post Setup Scripts",
          "number": 90,
          "startedAt": "2026-10-10T02:03:33Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-10-10T02:03:33Z",
          "conclusion": "success",
          "name": "Complete job",
          "number": 91,
          "startedAt": "2026-10-10T02:03:33Z",
          "status": "completed"
        }
      ],
      "url": "https://github.com/cli/cli/actions/runs/38015447143/job/114104688493"
    },
    {
      "completedAt": "0001-01-01T00:00:00Z",
      "conclusion": "",
      "databaseId": 114104878438,
      "name": "detection",
      "startedAt": "2026-10-10T02:03:38Z",
      "status": "in_progress",
      "steps": [
        {
          "completedAt": "2026-10-10T02:03:41Z",
          "conclusion": "success",
          "name": "Set up job",
          "number": 1,
          "startedAt": "2026-10-10T02:03:39Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-10-10T02:03:43Z",
          "conclusion": "success",
          "name": "Setup Scripts",
          "number": 2,
          "startedAt": "2026-10-10T02:03:41Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-10-10T02:03:45Z",
          "conclusion": "success",
          "name": "Download activation artifact",
          "number": 3,
          "startedAt": "2026-10-10T02:03:43Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-10-10T02:03:57Z",
          "conclusion": "success",
          "name": "Ensure threat-detection directory and log",
          "number": 13,
          "startedAt": "2026-10-10T02:03:57Z",
          "status": "completed"
        },
        {
          "completedAt": "2026-10-10T02:03:58Z",
          "conclusion": "success",
          "name": "Install AWF binary",
          "number": 14,
          "startedAt": "2026-10-10T02:03:57Z",
          "status": "completed"
        },
        {
          "completedAt": "0001-01-01T00:00:00Z",
          "conclusion": "",
          "name": "Install GitHub Copilot CLI",
          "number": 15,
          "startedAt": "2026-10-10T02:03:58Z",
          "status": "in_progress"
        },
        {
          "completedAt": "0001-01-01T00:00:00Z",
          "conclusion": "",
          "name": "Install threat-detect binary",
          "number": 16,
          "startedAt": "0001-01-01T00:00:00Z",
          "status": "pending"
        },
        {
          "completedAt": "0001-01-01T00:00:00Z",
          "conclusion": "",
          "name": "Execute threat detection with AWF",
          "number": 17,
          "startedAt": "0001-01-01T00:00:00Z",
          "status": "pending"
        },
        {
          "completedAt": "0001-01-01T00:00:00Z",
          "conclusion": "",
          "name": "Render detection log",
          "number": 18,
          "startedAt": "0001-01-01T00:00:00Z",
          "status": "pending"
        },
        {
          "completedAt": "0001-01-01T00:00:00Z",
          "conclusion": "",
          "name": "Post Setup Scripts",
          "number": 44,
          "startedAt": "0001-01-01T00:00:00Z",
          "status": "pending"
        }
      ],
      "url": "https://github.com/cli/cli/actions/runs/38015447143/job/114104878438"
    }
  ]
}`

/** `gh run view --json jobs` of a run that failed before any job started. */
export const JOBS_NONE = `{
  "jobs": []
}`
