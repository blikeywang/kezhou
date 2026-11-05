import unittest
from urllib.parse import parse_qs, urlsplit
from run_cycle import token_url, AUDIENCE

class IdentityEndpointTest(unittest.TestCase):
    def test_audience_and_host(self):
        url = token_url('https://oidc.actions.githubusercontent.com/a?x=1&audience=old')
        self.assertEqual(parse_qs(urlsplit(url).query), {'x': ['1'], 'audience': [AUDIENCE]})
        for url in ('http://oidc.actions.githubusercontent.com/a', 'https://evil.test/a', 'https://oidc.actions.githubusercontent.com.evil.test/a', 'https://x:y@oidc.actions.githubusercontent.com/a'):
            with self.assertRaises(ValueError): token_url(url)
