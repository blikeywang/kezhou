#!/usr/bin/env python3
"""Run the existing paper engine before export, using this GitHub job's OIDC identity."""
import json
import os
import time
import urllib.parse
import urllib.request
from export_public import ORIGIN, NoRedirect

AUDIENCE = ORIGIN + '/api/github-run'


def token_url(raw):
    parsed = urllib.parse.urlsplit(raw)
    if (parsed.scheme != 'https' or not (parsed.hostname or '').endswith('.actions.githubusercontent.com')
            or parsed.username or parsed.password or parsed.port not in (None, 443) or parsed.fragment):
        raise ValueError('Unexpected GitHub identity endpoint')
    query = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    query = [(k, v) for k, v in query if k != 'audience'] + [('audience', AUDIENCE)]
    return urllib.parse.urlunsplit(parsed._replace(query=urllib.parse.urlencode(query)))


def request_json(request, timeout):
    with urllib.request.build_opener(NoRedirect).open(request, timeout=timeout) as response:
        if 'application/json' not in response.headers.get('Content-Type', ''):
            raise ValueError('Unexpected runner response')
        body = response.read(200001)
        if len(body) > 200000:
            raise ValueError('Runner response too large')
        return json.loads(body)


def run():
    site_token = os.environ.get('MARKET_SIMULATION_SITE_TOKEN', '')
    request_token = os.environ.get('ACTIONS_ID_TOKEN_REQUEST_TOKEN', '')
    if not site_token or not request_token:
        raise ValueError('Cloud runner credentials unavailable')
    url = token_url(os.environ.get('ACTIONS_ID_TOKEN_REQUEST_URL', ''))
    for attempt in range(3):
        try:
            identity = request_json(urllib.request.Request(url, headers={'Authorization': 'Bearer ' + request_token}), 20)['value']
            result = request_json(urllib.request.Request(AUDIENCE, data=b'{}', method='POST', headers={
                'Authorization': 'Bearer ' + identity, 'OAI-Sites-Authorization': 'Bearer ' + site_token,
                'Content-Type': 'application/json', 'Accept': 'application/json'}), 100)
            if not result.get('ok') or time.time() * 1000 - result.get('lastRun', 0) > 20 * 60000:
                raise ValueError('Paper cycle did not produce a current ledger')
            print(json.dumps({k: result.get(k) for k in ('ok', 'lastRun', 'version', 'freshSymbols', 'openPositions', 'closedTrades')}))
            return
        except Exception:
            if attempt == 2:
                raise ValueError('Paper execution failed; check the service status, not the publication timestamp') from None
            time.sleep(15)


if __name__ == '__main__':
    run()
