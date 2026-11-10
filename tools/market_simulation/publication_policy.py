#!/usr/bin/env python3
"""Publication policy only; never calls the simulation service."""
import json
import os

def paper_cycle_allowed(event_name, publish_only="false"):
    # Preserve running legacy clock dispatches (no input) and the existing cron.
    # Data/code publication is not permission to execute paper plans.
    if event_name == "schedule":
        return True
    if event_name == "workflow_dispatch":
        return publish_only is False or publish_only == "false"
    return False

def main():
    allowed = paper_cycle_allowed(os.environ.get("PUBLICATION_EVENT", ""),
                                  os.environ.get("PUBLISH_ONLY", "false"))
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        output.write("run_paper_cycle=" + str(allowed).lower() + "\n")
    print(json.dumps({"event": os.environ.get("PUBLICATION_EVENT", ""),
                      "mode": "paper-cycle-and-publish" if allowed else "publish-only"}))

if __name__ == "__main__":
    main()
