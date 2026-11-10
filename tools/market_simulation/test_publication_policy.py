import unittest
from pathlib import Path
from publication_policy import paper_cycle_allowed

class PublicationPolicyTests(unittest.TestCase):
    def test_publication_events_never_execute(self):
        for event in ("push", "workflow_run", "pull_request", "", "unknown"):
            for flag in ("false", "true", "", False, True):
                self.assertFalse(paper_cycle_allowed(event, flag))
    def test_existing_scheduled_cycle_is_preserved(self):
        self.assertTrue(paper_cycle_allowed("schedule"))
        self.assertTrue(paper_cycle_allowed("schedule", "true"))
    def test_legacy_clock_dispatch_remains_compatible(self):
        self.assertTrue(paper_cycle_allowed("workflow_dispatch"))
        self.assertTrue(paper_cycle_allowed("workflow_dispatch", False))
    def test_explicit_read_only_dispatch_and_invalid_inputs(self):
        for flag in ("true", True, "", None, "FALSE", "0", "invalid"):
            self.assertFalse(paper_cycle_allowed("workflow_dispatch", flag))
    def test_workflow_gates_cycle_and_retains_cron_and_readback(self):
        root = Path(__file__).resolve().parents[2]
        workflow = (root / ".github/workflows/pages.yml").read_text()
        self.assertIn("cron: '6-56/10 * * * *'", workflow)
        self.assertIn("if: steps.publication_policy.outputs.run_paper_cycle == 'true'", workflow)
        self.assertIn("PAPER_CYCLE_OUTCOME: ${{ steps.paper_cycle.outcome }}", workflow)
        self.assertEqual(workflow.count("run: python tools/market_simulation/run_cycle.py"), 1)
        clock = (root / "tools/market_simulation/publication_clock.py").read_text()
        self.assertIn('dispatch(args.repository, "pages.yml")', clock)
