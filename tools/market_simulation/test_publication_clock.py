import os
import unittest
from unittest.mock import patch, MagicMock
from publication_clock import dispatch, next_tick


class PublicationClockTests(unittest.TestCase):
    def test_tick_follows_source_execution_and_is_strictly_future(self):
        for now in (0, 179, 180, 181, 599, 779, 780, 1000000000):
            self.assertGreater(next_tick(now), now)
            self.assertLessEqual(next_tick(now) - now, 600)
            self.assertEqual(next_tick(now) % 600, 180)

    def test_only_fixed_publisher_and_clock_can_be_dispatched(self):
        for repo, workflow in (("../other", "pages.yml"), ("a/b", "trading.yml")):
            with self.assertRaises(ValueError):
                dispatch(repo, workflow)

    def test_credentials_are_in_header_and_never_in_payload(self):
        response = MagicMock()
        response.__enter__.return_value.status = 204
        opener = MagicMock()
        opener.open.return_value = response
        with patch.dict(os.environ, {"GH_TOKEN": "private-fixture-token"}), patch("urllib.request.build_opener", return_value=opener):
            dispatch("blikeywang/kezhou", "pages.yml")
        request = opener.open.call_args.args[0]
        self.assertNotIn(b"private-fixture-token", request.data)
        self.assertNotIn("private-fixture-token", request.full_url)
        self.assertEqual(request.get_method(), "POST")


if __name__ == "__main__":
    unittest.main()
