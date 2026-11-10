import argparse
import base64
import json
import mimetypes
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import requests
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = 'https://steadier-9wkmejo8.manus.space'
TICKET = 'x' * 43
parser = argparse.ArgumentParser()
parser.add_argument('--live', action='store_true')
args = parser.parse_args()
checks = []


def check(condition, label):
    if not condition:
        raise AssertionError(label)
    checks.append(label)
    print('PASS:', label, flush=True)


with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    for missing_config in [False, True]:
        context = browser.new_context(viewport={'width': 390, 'height': 844}, service_workers='block')
        context.add_init_script("""
          window.__signInSpeech=[]; window.__signInStops=0;
          Object.defineProperty(window,'SpeechSynthesisUtterance',{value:function(text){this.text=text;}});
          Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[],speak:(u)=>{window.__signInSpeech.push(u.text);u.onstart?.();},cancel:()=>{window.__signInStops++;}}});
        """)
        navigations = []

        def intercept_portal(route):
            navigations.append(route.request.url)
            route.fulfill(status=200, content_type='text/plain', body='Test intercepted portal navigation. No real login submitted.')

        def application_route(route):
            parsed = urlparse(route.request.url)
            path = parsed.path
            if path == '/api/platform/config.js' and missing_config:
                route.fulfill(status=503, content_type='application/javascript', body='/* Offline/unavailable configuration test. */')
                return
            if args.live:
                route.continue_()
                return
            if path.startswith('/api/'):
                response = requests.request(route.request.method, 'http://127.0.0.1:3000' + path + ('?' + parsed.query if parsed.query else ''), timeout=10)
                route.fulfill(status=response.status_code, content_type=response.headers.get('Content-Type', 'text/plain'), body=response.content)
                return
            target = ROOT / 'dist/public' / path.lstrip('/')
            if path == '/':
                target = ROOT / 'dist/public/index.html'
            if not target.is_file():
                route.fulfill(status=404, body='Test route not found')
                return
            content_type = mimetypes.guess_type(str(target))[0] or 'application/octet-stream'
            route.fulfill(status=200, content_type=content_type, body=target.read_bytes())

        context.route(ORIGIN + '/**', application_route)
        context.route('https://manus.im/app-auth**', intercept_portal)
        # Do not send test page metadata to third-party analytics.
        context.route('https://plausible.io/**', lambda route: route.abort())
        context.route('https://manus-analytics.com/**', lambda route: route.abort())
        page = context.new_page()
        page.goto(ORIGIN + '/?compass_oauth=' + TICKET)
        page.get_by_role('button', name='Sign in with Manus', exact=True).wait_for(timeout=20000)
        check(page.evaluate('window.__signInSpeech.length') == 0, 'signed-out page does not speak or listen automatically')
        if not missing_config:
            check(page.evaluate('Boolean(window.__MANUS_CONFIG__?.projectId && window.__MANUS_CONFIG__?.oauthPortalUrl)'), 'fresh browser receives public runtime sign-in configuration before use')
            page.get_by_role('button', name='Read sign-in help aloud', exact=True).click()
            check(page.evaluate('window.__signInSpeech.some(t=>t.includes("Nothing is shared"))'), 'signed-out sign-in help has opt-in read-aloud')
            page.get_by_role('button', name='Stop reading', exact=True).click()
            check(page.evaluate('window.__signInStops') > 0, 'signed-out read-aloud has explicit stop')
            page.get_by_role('button', name='Sign in with Manus', exact=True).click()
            page.wait_for_url('https://manus.im/app-auth**', timeout=15000)
            check(len(navigations) == 1, 'one click starts one intercepted portal navigation without submitting login')
            query = parse_qs(urlparse(navigations[0]).query)
            check(query.get('redirectUri') == [ORIGIN + '/api/oauth/callback'], 'login uses the actual HTTPS frontend callback')
            check(query.get('responseType') == ['code'], 'real login remains authorization-code flow')
            state = json.loads(base64.b64decode(query['state'][0]))
            cookies = {cookie['name']: cookie for cookie in context.cookies(ORIGIN)}
            check(state['nonce'] == cookies.get('__Host-oauth_state', {}).get('value'), 'login state is bound to the initiating browser nonce cookie')
            check(state['redirectUri'] == ORIGIN + '/api/oauth/callback', 'state preserves fixed callback URI')
            check(cookies.get('__Host-steadier-compass-return', {}).get('value') == TICKET, 'sign-in preserves only the fixed in-app consent return ticket')
            check(cookies['__Host-oauth_state']['secure'] and cookies['__Host-oauth_state']['sameSite'] == 'None', 'nonce cookie preserves HTTPS and cross-site callback handling')
        else:
            page.get_by_role('button', name='Sign in with Manus', exact=True).click()
            page.get_by_role('alert').filter(has_text='Sign-in settings could not be loaded').wait_for(timeout=10000)
            check(len(navigations) == 0, 'missing configuration fails closed without portal navigation')
        context.close()
    browser.close()

report = {'mode': 'live' if args.live else 'local-built-assets', 'checks': checks, 'credentialsRecorded': False, 'actualLoginSubmitted': False}
path = ROOT / '.webdev' / ('login-bootstrap-live-results.json' if args.live else 'login-bootstrap-results.json')
path.parent.mkdir(exist_ok=True)
path.write_text(json.dumps(report, indent=2) + '\n')
print('All targeted browser checks passed; no account login or Claude grant submitted.', flush=True)
