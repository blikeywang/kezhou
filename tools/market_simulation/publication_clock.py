#!/usr/bin/env python3
"""Bounded GitHub runner clock. Credentials are the job's ephemeral GITHUB_TOKEN.

workflow_dispatch is used rather than relying on the best-effort cron queue.
This clock only asks the existing read-only publisher to run; it never trades.
"""
import argparse
import json
import os
import re
import time
import urllib.error
import urllib.request


REPOSITORY = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]*/[A-Za-z0-9_][A-Za-z0-9_.-]*")


def _valid_repository(repository):
    return bool(REPOSITORY.fullmatch(repository or "")) and ".." not in repository


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def dispatch(repository, workflow, inputs=None):
    if not _valid_repository(repository):
        raise ValueError("Invalid repository")
    if workflow not in ("pages.yml", "market-publication-clock.yml"):
        raise ValueError("Unexpected workflow")
    token = os.environ.get("GH_TOKEN", "")
    if not token:
        raise ValueError("Missing job token")
    request = urllib.request.Request(
        f"https://api.github.com/repos/{repository}/actions/workflows/{workflow}/dispatches",
        data=json.dumps({"ref": "main", "inputs": inputs or {}}).encode(),
        headers={"Authorization": "Bearer " + token, "Accept": "application/vnd.github+json",
                 "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28"},
        method="POST")
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=25) as response:
            if response.status != 204:
                raise ValueError("Publisher dispatch not accepted")
    except urllib.error.HTTPError as exc:
        raise ValueError("Publisher dispatch HTTP " + str(exc.code)) from None


BUSY_STATUSES = ("queued", "in_progress", "waiting", "pending", "requested")


def publisher_busy(repository, workflow="pages.yml"):
    """True while an earlier publish run is still queued or deploying.

    GitHub Pages processes one deployment at a time. When Pages is slow, a new
    dispatch every ten minutes only piles more runs behind the stuck one and
    each of them later fails with "Timeout reached" (one failure e-mail per
    run). Skipping the tick lets the running deployment finish; the next tick
    publishes the newest snapshot anyway. Lookup errors never block publishing.
    """
    if not _valid_repository(repository):
        raise ValueError("Invalid repository")
    if workflow != "pages.yml":
        raise ValueError("Unexpected workflow")
    token = os.environ.get("GH_TOKEN", "")
    if not token:
        return False
    for status in BUSY_STATUSES:
        request = urllib.request.Request(
            f"https://api.github.com/repos/{repository}/actions/workflows/{workflow}/runs?status={status}&per_page=1",
            headers={"Authorization": "Bearer " + token, "Accept": "application/vnd.github+json",
                     "X-GitHub-Api-Version": "2022-11-28"},
            method="GET")
        try:
            with urllib.request.build_opener(NoRedirect).open(request, timeout=20) as response:
                payload = json.loads(response.read().decode() or "{}")
        except (urllib.error.URLError, ValueError, TimeoutError):
            return False
        if int(payload.get("total_count") or 0) > 0:
            return True
    return False


def next_tick(now):
    # Source execution begins at :01/:11; ask for publication at :03/:13.
    return (int(now) - 180) // 600 * 600 + 780


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", required=True)
    parser.add_argument("--minutes", type=int, default=330)
    parser.add_argument("--continue-clock", action="store_true")
    args = parser.parse_args()
    if not 10 <= args.minutes <= 330:
        raise ValueError("Clock duration outside the bounded range")
    deadline = time.monotonic() + args.minutes * 60
    failures = 0
    while time.monotonic() < deadline:
        try:
            if publisher_busy(args.repository):
                print(json.dumps({"skippedAt": int(time.time() * 1000), "reason": "publisher_busy"}), flush=True)
            else:
                dispatch(args.repository, "pages.yml")
                print(json.dumps({"requestedAt": int(time.time() * 1000), "workflow": "pages.yml"}), flush=True)
            failures = 0
        except ValueError as exc:
            failures += 1
            print(json.dumps({"error": str(exc), "consecutiveFailures": failures}), flush=True)
            if failures >= 3:
                raise
        wake = next_tick(time.time())
        while time.monotonic() < deadline and time.time() < wake:
            time.sleep(min(30, max(.1, wake - time.time()), max(.1, deadline - time.monotonic())))
    if args.continue_clock:
        dispatch(args.repository, "market-publication-clock.yml", {"minutes": "330", "continue_clock": "true"})
        print('{"successorRequested":true}', flush=True)


if __name__ == "__main__":
    main()
