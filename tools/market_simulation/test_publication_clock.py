import os
import unittest
from unittest.mock import patch, MagicMock
from publication_clock import dispatch, next_tick, publisher_busy


def _opener_with(counts):
    """Fake opener answering total_count per requested status."""
    def open_(request, timeout=0):
        status = request.full_url.split("status=")[1].split("&")[0]
        response = MagicMock()
        response.__enter__.return_value.read.return_value = ('{"total_count": %d}' % counts.get(status, 0)).encode()
        return response
    opener = MagicMock()
    opener.open.side_effect = open_
    return opener


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

    def test_busy_publisher_skips_the_tick(self):
        with patch.dict(os.environ, {"GH_TOKEN": "fixture"}), patch("urllib.request.build_opener", return_value=_opener_with({"in_progress": 1})):
            self.assertTrue(publisher_busy("blikeywang/kezhou"))
        with patch.dict(os.environ, {"GH_TOKEN": "fixture"}), patch("urllib.request.build_opener", return_value=_opener_with({"queued": 2})):
            self.assertTrue(publisher_busy("blikeywang/kezhou"))

    def test_idle_publisher_or_lookup_error_never_blocks(self):
        with patch.dict(os.environ, {"GH_TOKEN": "fixture"}), patch("urllib.request.build_opener", return_value=_opener_with({})):
            self.assertFalse(publisher_busy("blikeywang/kezhou"))
        broken = MagicMock()
        broken.open.side_effect = TimeoutError()
        with patch.dict(os.environ, {"GH_TOKEN": "fixture"}), patch("urllib.request.build_opener", return_value=broken):
            self.assertFalse(publisher_busy("blikeywang/kezhou"))
        with self.assertRaises(ValueError):
            publisher_busy("../other")


if __name__ == "__main__":
    unittest.main()
