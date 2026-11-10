#!/usr/bin/env python3
"""Remembered shared-startup regressions. Mocked private APIs only; no real accounts/data."""
import copy
import json
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
LOCAL = 'http://localhost:3000'
PUBLIC = 'https://steadier-9wkmejo8.manus.space'
KEY = 'steadier.workspace.v2.personal'
PREF = 'steadier.startup.v1'
SOURCE = json.loads((ROOT / '.webdev/backup-text-source.json').read_text())
checks = []


def check(value, label):
    assert value, label
    checks.append(label)
    print('PASS:', label, flush=True)


def nav(page, label):
    page.locator('.sidebar').get_by_role('button', name=label, exact=True).click()


def shared(page):
    page.locator('.workspace-switch').filter(has_text='Server ·').wait_for()


def setup(browser, pref=None, user=71, public=False, fail_workspace=False, old_cache=None):
    context = browser.new_context(viewport={'width':1440,'height':1050})
    requests = []
    workspace = copy.deepcopy(SOURCE)
    for task in workspace['tasks']:
        task['title'] = 'SERVER SYNTHETIC ' + task['title']
    record = {'workspace':workspace,'revision':4,'updatedAt':'2026-10-24T09:00:00.000Z','timeZone':'Australia/Adelaide','focusOwnerClientId':None}
    seed = {'original':json.dumps(SOURCE),'pref':pref,'old':old_cache}
    context.add_init_script(f'''(() => {{
      if (!sessionStorage.getItem('synthetic-seeded')) {{
        const s={json.dumps(seed)};
        if (!localStorage.getItem('{KEY}')) localStorage.setItem('{KEY}',s.original);
        if (s.pref!==null && !localStorage.getItem('{PREF}')) localStorage.setItem('{PREF}',JSON.stringify(s.pref));
        if (s.old!==null) localStorage.setItem('steadier.cloud.v1.user.71',s.old);
        sessionStorage.setItem('synthetic-seeded','yes');
      }}
      window.__speech=[];window.__stops=0;
      Object.defineProperty(window,'SpeechSynthesisUtterance',{{value:function(t){{this.text=t;}}}});
      Object.defineProperty(window,'speechSynthesis',{{value:{{getVoices:()=>[],speak:(u)=>{{window.__speech.push(u.text);u.onstart?.();}},cancel:()=>{{window.__stops++;}}}}}});
    }})();''')
    if public:
        # Serve the current local build under the canonical origin. This never
        # sends a request to the actual published server or its private database.
        def local_proxy(route):
            u=urlsplit(route.request.url)
            response=route.fetch(url=LOCAL+u.path+('?' + u.query if u.query else ''))
            route.fulfill(response=response)
        context.route(PUBLIC+'/**',local_proxy)
    context.route('**/__manus__/debug-collector.js',lambda r:r.fulfill(status=200,content_type='application/javascript',body=''))

    def api(route):
        path=route.request.url.split('/api/steadier/',1)[1].split('?')[0]
        requests.append((path,route.request.method))
        if path=='session':
            session_count=sum(1 for item,_ in requests if item=='session')
            session_user=user[min(session_count-1,len(user)-1)] if isinstance(user,list) else user
            if session_user is None:
                route.fulfill(status=401,json={'message':'Sign in to access your shared records.'})
            else:
                route.fulfill(status=200,json={'user':{'id':session_user,'name':'Synthetic startup account'}})
        elif path=='workspace' and route.request.method=='GET':
            if fail_workspace:
                route.fulfill(status=503,json={'message':'Synthetic server temporarily unavailable.'})
            else:
                route.fulfill(status=200,json=record)
        elif path=='workspace':
            route.fulfill(status=500,json={'message':'Unexpected write blocked by synthetic test.'})
        elif path=='compass-keys':
            route.fulfill(status=200,json={'keys':[]})
        else:
            route.fulfill(status=503,json={'message':'Synthetic optional service unavailable.'})
    context.route('**/api/steadier/**',api)
    page=context.new_page();page.set_default_timeout(12000)
    return context,page,requests,PUBLIC if public else LOCAL


with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])

    c,p,req,url=setup(browser)
    p.goto(url,wait_until='domcontentloaded')
    p.locator('.workspace-switch').wait_for()
    p.wait_for_timeout(350)
    check(not any(path=='workspace' for path,_ in req),'unselected Preview stays local even with a valid mocked sign-in')
    check(p.evaluate(f'localStorage.getItem("{KEY}")')==json.dumps(SOURCE),'Preview original personal bytes are unchanged')
    c.close()

    c,p,req,url=setup(browser,pref={'version':1,'mode':'shared','userId':71})
    p.goto(url,wait_until='domcontentloaded');shared(p)
    check(any(path=='workspace' for path,_ in req),'remembered shared selection reopens after verified same-owner session')
    check(p.evaluate(f'localStorage.getItem("{KEY}")')==json.dumps(SOURCE),'shared startup does not overwrite or upload original browser jobs')
    p.reload(wait_until='domcontentloaded');shared(p)
    check(True,'shared personal automatically reopens after reload without another switch')
    other=c.new_page();other.set_default_timeout(12000);other.goto(url,wait_until='domcontentloaded');shared(other)
    check(True,'a new tab reopens the same remembered shared personal collection')
    other.close()
    p.set_viewport_size({'width':1440,'height':1050})
    nav(p,'Server & Compass')
    p.get_by_role('button',name='View original browser space',exact=True).click()
    check(json.loads(p.evaluate(f'localStorage.getItem("{PREF}")'))['mode']=='browser','explicit original-browser choice is remembered')
    prior=len(req);p.reload(wait_until='domcontentloaded');p.locator('.workspace-switch').wait_for();p.wait_for_timeout(250)
    check(not any(path=='workspace' for path,_ in req[prior:]),'original-browser selection does not silently reconnect on reload')
    p.locator('.workspace-switch').click()
    check(json.loads(p.evaluate(f'localStorage.getItem("{PREF}")'))['mode']=='demo','explicit sample choice is remembered')
    prior=len(req);p.reload(wait_until='domcontentloaded');p.locator('.workspace-switch').wait_for();p.wait_for_timeout(250)
    check(not any(path=='workspace' for path,_ in req[prior:]),'sample choice stays separate after reload')
    check(not any(method=='PUT' for _,method in req),'startup and mode selection perform no shared writes or focus claims')
    c.close()

    c,p,req,url=setup(browser,pref={'version':1,'mode':'shared','userId':71},user=72,old_cache='PRIVATE_OLD_OWNER_SENTINEL')
    p.goto(url,wait_until='domcontentloaded');p.get_by_role('button',name='Retry shared space',exact=True).wait_for();p.wait_for_timeout(300)
    check(not any(path=='workspace' for path,_ in req),'different account cannot automatically open a stored shared-owner preference')
    check('PRIVATE_OLD_OWNER_SENTINEL' not in p.locator('body').inner_text(),'previous owner cache is never exposed by startup preference')
    check(p.evaluate('localStorage.getItem("steadier.cloud.v1.user.71")')=='PRIVATE_OLD_OWNER_SENTINEL','mismatched owner cache bytes are protected')
    p.get_by_role('button',name='Open original browser space',exact=True).click();p.locator('.workspace-switch').wait_for()
    check(True,'account-mismatch gate has an explicit safe browser escape')
    c.close()

    c,p,req,url=setup(browser,pref={'version':1,'mode':'shared','userId':71},user=None)
    p.goto(url,wait_until='domcontentloaded');p.get_by_role('button',name='Sign in with Manus',exact=True).wait_for()
    check(p.locator('.app-shell').count()==0,'expired login holds the guarded screen rather than editable sample work')
    p.set_viewport_size({'width':390,'height':844})
    check(p.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'guarded shared-opening controls fit a phone viewport')
    p.get_by_role('button',name='Read opening help aloud',exact=True).click()
    check(p.evaluate('window.__speech.some(t=>t.includes("not been moved"))'),'shared opening guidance supports explicit voice without reading private job JSON')
    p.get_by_role('button',name='Stop reading',exact=True).click()
    check(p.evaluate('window.__stops>0'),'opening-screen read-aloud has an explicit stop')
    p.set_viewport_size({'width':1440,'height':1050})
    p.get_by_role('button',name='View sample lab instead',exact=True).click();p.locator('.workspace-switch').wait_for()
    check(not any(path=='workspace' for path,_ in req),'deliberate sample escape cancels expired shared startup')
    c.close()

    c,p,req,url=setup(browser,pref={'version':1,'mode':'shared','userId':71},fail_workspace=True)
    p.goto(url,wait_until='domcontentloaded');p.get_by_role('button',name='Retry shared space',exact=True).wait_for();p.wait_for_timeout(300)
    check(p.locator('.app-shell').count()==0,'failed server read never claims shared success or opens editable demo')
    check(not any(method=='PUT' for _,method in req),'failed startup does not upload or replace any server work')
    c.close()

    c,p,req,url=setup(browser,public=True)
    p.goto(url,wait_until='domcontentloaded');shared(p)
    check(True,'authenticated canonical published first visit opens shared without a manual mode switch')
    check(json.loads(p.evaluate(f'localStorage.getItem("{PREF}")'))=={'version':1,'mode':'shared','userId':71},'published default stores only a verified non-secret shared preference')
    check(not any(method=='PUT' for _,method in req),'published first opening is a read, not a data migration')
    c.close()

    c,p,req,url=setup(browser,pref={'version':1,'mode':'shared','userId':71},public=True)
    c.route('**/api/compass/oauth/**',lambda route:route.fulfill(status=400,json={'message':'Synthetic consent ticket unavailable.'}))
    p.goto(url+'/?compass_oauth='+'A'*43,wait_until='domcontentloaded')
    p.get_by_role('heading',name='Your permission, not a public link.',exact=False).wait_for()
    p.wait_for_timeout(300)
    check(not any(path=='workspace' for path,_ in req),'Claude permission page discovers sign-in only without reopening shared records or pending writes')
    c.close()

    c,p,req,url=setup(browser,public=True,user=None)
    p.goto(url,wait_until='domcontentloaded');p.get_by_role('button',name='Sign in with Manus',exact=True).wait_for();p.wait_for_timeout(200)
    check(p.locator('.app-shell').count()==0,'fresh published login failure remains guarded instead of editable sample work')
    check(not any(path=='workspace' for path,_ in req),'missing published sign-in does not open private server data')
    c.close()

    c,p,req,url=setup(browser,pref={'version':1,'mode':'shared','userId':71},user=[71,72])
    p.goto(url,wait_until='domcontentloaded');p.get_by_role('button',name='Retry shared space',exact=True).wait_for();p.wait_for_timeout(350)
    check(not any(path=='workspace' for path,_ in req),'account transition during auto-connect stops before any different-owner workspace read')
    check(json.loads(p.evaluate(f'localStorage.getItem("{PREF}")'))['userId']==71,'automatic account transition preserves the original shared-owner choice')
    check(p.locator('.app-shell').count()==0,'account transition requires deliberate reconnect in the guard')
    c.close();browser.close()

(ROOT/'.webdev/shared-startup-results.json').write_text(json.dumps({'checks':checks,'actualOwnerRecordsRead':False,'actualServerRecordsWritten':False},indent=2)+'\n')
print('All targeted shared-startup checks passed with synthetic APIs only.',flush=True)
