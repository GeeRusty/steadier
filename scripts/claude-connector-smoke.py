import argparse
import base64
import copy
import hashlib
import json
import secrets
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

import requests
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / '.webdev/server-test-fixtures.json'
MCP_URL = 'https://steadier-9wkmejo8.manus.space/api/compass/mcp'
READ_SCOPE = 'steadier:read'
parser = argparse.ArgumentParser()
parser.add_argument('--base', default='http://localhost:3000')
parser.add_argument('--skip-browser', action='store_true')
args = parser.parse_args()
base = args.base.rstrip('/')
fixture = json.loads(FIXTURES.read_text())
a, b = fixture['identities']
results = []


def check(condition, label):
    if not condition:
        raise AssertionError(label)
    results.append(label)
    print('PASS:', label, flush=True)


def owner_session(identity):
    session = requests.Session()
    session.cookies.set('webdev_app_session', identity['cookie'])
    session.headers.update({'X-Steadier-Request': '1', 'X-Steadier-Owner': str(identity['id'])})
    return session


sa, sb = owner_session(a), owner_session(b)
key_ids_before = {k['id'] for k in sa.get(base + '/api/steadier/compass-keys', timeout=10).json()['keys']}
record = sa.get(base + '/api/steadier/workspace', timeout=10).json()
if record['revision'] == 0:
    saved = sa.put(base + '/api/steadier/workspace', json={
        'baseRevision': 0,
        'workspace': fixture['workspace'],
        'clientId': secrets.token_hex(16),
        'timeZone': 'Australia/Adelaide',
    }, timeout=10)
    check(saved.status_code == 200, 'only isolated synthetic workspace seeded')
    record = saved.json()
baseline = copy.deepcopy(sa.get(base + '/api/steadier/workspace', timeout=10).json())
redirect = 'https://claude.ai/api/mcp/auth_callback'
verifier = secrets.token_urlsafe(48)
challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode('ascii')).digest()).decode().rstrip('=')
client = requests.post(base + '/api/compass/oauth/register', json={
    'client_name': 'Synthetic Claude protocol check',
    'redirect_uris': [redirect],
    'grant_types': ['authorization_code'],
    'response_types': ['code'],
    'token_endpoint_auth_method': 'none',
    'client_uri': 'https://claude.ai',
}, timeout=10)
check(client.status_code == 201, 'public dynamic registration uses canonical read-only OAuth metadata')
client_id = client.json()['client_id']
state = secrets.token_urlsafe(24)
authorize = requests.get(base + '/api/compass/oauth/authorize', params={
    'response_type': 'code', 'client_id': client_id, 'redirect_uri': redirect,
    'state': state, 'scope': READ_SCOPE, 'resource': MCP_URL,
    'code_challenge': challenge, 'code_challenge_method': 'S256',
}, allow_redirects=False, timeout=10)
check(authorize.status_code == 302, 'authorization opens owner permission instead of auto-granting')
ticket = parse_qs(urlparse(authorize.headers['Location']).query)['compass_oauth'][0]
request_path = f'/api/compass/oauth/requests/{ticket}'
check(requests.get(base + request_path, timeout=10).status_code == 401, 'anonymous permission request cannot read account counts')
view = sa.get(base + request_path, timeout=10)
check(view.status_code == 200 and view.json()['taskCount'] == len(baseline['workspace']['tasks']), 'permission shows only signed-in synthetic owner records')
check(sb.get(base + request_path, timeout=10).status_code == 404, 'another account cannot claim the displayed permission request')
check(sb.post(base + request_path + '/decision', json={'approve': True}, timeout=10).status_code == 404, 'another account cannot approve this owner grant')

try:
    if args.skip_browser:
        decision = sa.post(base + request_path + '/decision', json={'approve': True}, timeout=10)
        check(decision.status_code == 200, 'explicit authenticated approval produces a one-time callback')
        callback = decision.json()['redirectUrl']
    else:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
            context = browser.new_context(viewport={'width': 390, 'height': 844})
            context.add_cookies([{'name': 'webdev_app_session', 'value': a['cookie'], 'url': base, 'httpOnly': True, 'sameSite': 'Lax'}])
            context.add_init_script("""
              window.__permissionSpeech=[]; window.__speechStops=0;
              Object.defineProperty(window,'SpeechSynthesisUtterance',{value:function(text){this.text=text;}});
              Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[],speak:(u)=>{window.__permissionSpeech.push(u.text);u.onstart?.();},cancel:()=>{window.__speechStops++;}}});
            """)
            page = context.new_page()
            # Capture the OAuth callback locally, never submit a synthetic code to Claude.
            page.route('https://claude.ai/**', lambda route: route.fulfill(status=200, content_type='text/plain', body='Synthetic callback captured locally.'))
            page.goto(base + '/?compass_oauth=' + ticket)
            page.get_by_role('button', name='Allow read-only access', exact=True).wait_for(timeout=20000)
            check(page.get_by_text(a['name'], exact=False).count() > 0, 'phone permission page identifies the actual signed-in account')
            check(page.evaluate('window.__permissionSpeech.length') == 0, 'permission page does not speak or listen automatically')
            page.get_by_role('button', name='Read permission aloud', exact=True).click()
            check(page.evaluate('window.__permissionSpeech.some(t=>t.includes("cannot change tasks"))'), 'permission read-aloud uses existing opt-in voice control')
            page.get_by_role('button', name='Stop reading', exact=True).click()
            check(page.evaluate('window.__speechStops') > 0, 'permission read-aloud has an explicit stop control')
            framed_page = context.new_page()
            framed_page.goto(base + '/')
            framed_page.set_content('<iframe src="' + base + '/?compass_oauth=' + ticket + '"></iframe>')
            framed_allow = framed_page.frame_locator('iframe').get_by_role('button', name='Allow read-only access', exact=True)
            framed_allow.wait_for(timeout=20000)
            check(framed_allow.is_disabled(), 'permission cannot be clickjacked through embedded approval controls')
            framed_page.close()
            page.get_by_role('button', name='Allow read-only access', exact=True).click()
            page.wait_for_url('https://claude.ai/**', timeout=20000)
            callback = page.url
            check('code=' in callback, 'browser explicit consent returns to the registered callback without sending externally')
            browser.close()

    params = parse_qs(urlparse(callback).query)
    check(params.get('state') == [state], 'callback preserves the client anti-forgery state')
    code = params['code'][0]
    token_body = {'grant_type': 'authorization_code', 'client_id': client_id, 'redirect_uri': redirect, 'code': code, 'code_verifier': verifier, 'resource': MCP_URL}
    token_response = requests.post(base + '/api/compass/oauth/token', data=token_body, timeout=10)
    check(token_response.status_code == 200, 'persisted one-time PKCE code exchanges for a reader credential')
    token_json = token_response.json()
    check(token_json['token_type'] == 'Bearer' and token_json['scope'] == READ_SCOPE and 'refresh_token' not in token_json, 'issued OAuth credential has only read scope and bounded lifetime')
    reader = token_json['access_token']
    check(requests.post(base + '/api/compass/oauth/token', data=token_body, timeout=10).status_code == 400, 'code replay is rejected by persisted atomic consumption')
    headers = {'Authorization': 'Bearer ' + reader, 'Accept': 'application/json,text/event-stream', 'MCP-Protocol-Version': '2025-11-25'}

    def rpc(method, params=None, identifier=1):
        body = {'jsonrpc': '2.0', 'id': identifier, 'method': method, 'params': params or {}}
        response = requests.post(base + '/api/compass/mcp', json=body, headers=headers, timeout=10)
        print('MCP response:', method, response.status_code, response.headers.get('Cache-Control'), response.headers.get('Content-Type'), flush=True)
        check(response.status_code == 200 and 'no-store' in response.headers.get('Cache-Control', ''), 'authenticated MCP ' + method + ' stays private and uncached')
        if 'application/json' in response.headers.get('Content-Type', ''):
            return response.json()
        messages = [json.loads(line[5:].strip()) for line in response.text.splitlines() if line.startswith('data:')]
        matched = [message for message in messages if message.get('id') == identifier]
        if not matched:
            raise AssertionError('Legacy SSE did not contain the requested RPC result')
        return matched[-1]

    initialized = rpc('initialize', {'protocolVersion': '2025-11-25', 'capabilities': {}, 'clientInfo': {'name': 'synthetic-claude-check', 'version': '1.0'}})
    check('result' in initialized, 'Claude-compatible legacy MCP handshake succeeds')
    listing = rpc('tools/list', identifier=2)['result']['tools']
    check(len(listing) == 4 and all(t['annotations']['readOnlyHint'] and not t['annotations']['destructiveHint'] for t in listing), 'all four advertised MCP tools are read-only')
    context_result = rpc('tools/call', {'name': 'read_my_life_context', 'arguments': {}}, 3)['result']
    data = context_result['structuredContent']
    check(data['workspace']['tasks'][0]['id'] == baseline['workspace']['tasks'][0]['id'], 'OAuth-issued reader sees its own latest saved task context')
    check(data['freshness']['revision'] == baseline['revision'], 'MCP context gives the current saved revision')
    trusted_origin = requests.post(base + '/api/compass/mcp', json={'jsonrpc':'2.0','id':5,'method':'tools/list','params':{}}, headers={**headers,'Origin':'https://claude.ai'}, timeout=10)
    check(trusted_origin.status_code == 200, 'authenticated known Claude origin is compatible without permitting hostile origins')
    check(sa.get(base + '/api/steadier/workspace', timeout=10).json() == baseline, 'consent and MCP reads do not change the saved workspace')
    # Revoke only credentials created for this isolated synthetic test account.
    after_keys = sa.get(base + '/api/steadier/compass-keys', timeout=10).json()['keys']
    new_keys = [k for k in after_keys if k['id'] not in key_ids_before]
    check(len(new_keys) == 1, 'consent mints exactly one revocable synthetic reader key')
    for key in new_keys:
        check(sa.delete(base + f"/api/steadier/compass-keys/{key['id']}", json={}, timeout=10).status_code == 200, 'normal app revocation disables the OAuth-issued reader')
    denied = requests.post(base + '/api/compass/mcp', json={'jsonrpc': '2.0', 'id': 4, 'method': 'tools/list'}, headers=headers, timeout=10)
    check(denied.status_code == 401, 'revoked OAuth credential immediately loses MCP discovery/read access')
finally:
    try:
        for k in sa.get(base + '/api/steadier/compass-keys', timeout=10).json()['keys']:
            if k['id'] not in key_ids_before and not k['revokedAt']:
                sa.delete(base + f"/api/steadier/compass-keys/{k['id']}", json={}, timeout=10)
    except Exception:
        pass

out = ROOT / 'docs/test-artifacts'
out.mkdir(parents=True, exist_ok=True)
(out / 'claude-connector-smoke-results.json').write_text(json.dumps({'base': base, 'checks': results, 'data': 'synthetic only; credentials excluded'}, indent=2) + '\n')
print('Completed synthetic consent-to-reader-to-revocation flow.', flush=True)
