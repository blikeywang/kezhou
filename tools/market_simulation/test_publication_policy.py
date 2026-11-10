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


class DailyRefreshTriggerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(__file__).resolve().parents[2]
        cls.daily = (cls.root / '.github/workflows/daily.yml').read_text()
        block = cls.daily.split('    paths:\n', 1)[1].split('  schedule:', 1)[0]
        cls.paths = [line.strip()[3:-1] for line in block.splitlines()
                     if line.strip().startswith('- "')]

    def triggered(self, path):
        from fnmatch import fnmatchcase
        return any(fnmatchcase(path, pattern) for pattern in self.paths)

    def test_refresh_dependencies_still_trigger(self):
        for path in ('pipeline/daily/run.py', 'pipeline/daily/meta.json',
                     'pipeline/daily/requirements.txt', 'pipeline/daily/ui-v21.patch',
                     'tools/tailtrend/refresh.mjs', 'tools/incomeos/data-quality.mjs',
                     'tools/scheduler/refresh-runner.mjs', 'personal-data-hub/server.py',
                     'portal/test_tailtrend_engine.mjs', 'portal/vendor/tailtrend/tailtrend-engine.mjs',
                     'portal/vendor/incomeos/incomeos-engine.mjs', 'portal/vendor/otc/engine.mjs',
                     'portal/vendor/review/review-community.mjs',
                     'portal/assets/personal-data-hub.mjs',
                     'tools/otc/update_public_prices.py', 'portal/vendor/otc/data/snapshot.json',
                     '.github/workflows/daily.yml'):
            with self.subTest(path=path):
                self.assertTrue(self.triggered(path))

    def test_ui_and_published_outputs_do_not_duplicate_refresh(self):
        for path in ('portal/home/index.html', 'portal/assets/app.css',
                     'portal/vendor/tailtrend/data/latest.json',
                     'portal/vendor/daily-trade/data/index.json',
                     'portal/vendor/otc/data/prices.json', 'prototype/app.html',
                     'README.md', 'docs/METHODS_AND_SOURCES.md'):
            with self.subTest(path=path):
                self.assertFalse(self.triggered(path))

    def test_existing_schedule_and_dispatch_are_unchanged(self):
        self.assertEqual(self.daily.count('cron:'), 2)
        self.assertIn('cron: "35 0 * * *"', self.daily)
        self.assertIn('cron: "30 6 * * *"', self.daily)
        self.assertIn('workflow_dispatch: {}', self.daily)
        self.assertIn('python tools/otc/update_public_prices.py', self.daily)
        self.assertIn('python pipeline/daily/run.py', self.daily)
        pages = (self.root / '.github/workflows/pages.yml').read_text()
        self.assertIn("- 'portal/**'", pages)
        self.assertIn('workflows: [daily-refresh]', pages)

    def test_queued_refresh_checks_out_latest_main_not_event_sha(self):
        checkout = self.daily.split("- uses: actions/checkout@v6", 1)[1].split("- uses:", 1)[0]
        self.assertIn("with:", checkout)
        self.assertIn("ref: main", checkout)
        self.assertNotIn("github.sha", checkout)
        self.assertIn("cancel-in-progress: false", self.daily)
        self.assertIn("git pull --rebase origin main", self.daily)
        self.assertIn("git rebase --abort; exit 1", self.daily)
        self.assertNotIn("git push --force", self.daily)
