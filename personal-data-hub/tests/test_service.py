from __future__ import annotations

import os
import tempfile
import unittest


_temp_data = tempfile.TemporaryDirectory()
os.environ["TRADERHOME_HUB_DATA_DIR"] = _temp_data.name

from fastapi.testclient import TestClient

from traderhome_hub.service import account_token, app


class ServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        cls.client.close()
        _temp_data.cleanup()

    def test_health_is_read_only_and_does_not_expose_token(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["ok"])
        self.assertTrue(payload["readonly"])
        self.assertNotIn(account_token, response.text)

    def test_account_endpoints_require_local_token(self):
        response = self.client.get("/api/v1/account/summary")
        self.assertEqual(response.status_code, 401)

    def test_connect_only_redirects_to_allowed_origins(self):
        denied = self.client.get("/connect", params={"return": "https://example.com/review/"})
        self.assertEqual(denied.status_code, 400)
        allowed = self.client.get(
            "/connect",
            params={"return": "https://traderhome-histroy.xyz/review/?hub_import=1"},
            follow_redirects=False,
        )
        self.assertEqual(allowed.status_code, 302)
        self.assertIn("#hub_url=", allowed.headers["location"])
        self.assertIn("hub_token=", allowed.headers["location"])

    def test_private_network_preflight_is_allowed_only_for_traderhome(self):
        response = self.client.options(
            "/api/v1/account/summary?provider=longbridge",
            headers={
                "Origin": "https://traderhome-histroy.xyz",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization",
                "Access-Control-Request-Private-Network": "true",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["access-control-allow-origin"], "https://traderhome-histroy.xyz")
        self.assertEqual(response.headers["access-control-allow-private-network"], "true")


if __name__ == "__main__":
    unittest.main()
