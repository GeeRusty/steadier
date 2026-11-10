#!/usr/bin/env python3
"""Server/API and two-device checks; only the explicitly synthetic identities created by server-smoke-fixtures.ts."""
import copy,csv,io,json
from pathlib import Path
import requests
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
fixture=json.loads((ROOT/'.webdev/server-test-fixtures.json').read_text())
BASE='http://localhost:3000'
results=[]
def passed(name):
    results.append({'check':name,'result':'passed'});print(name+': passed',flush=True)
def session(identity):
    s=requests.Session();s.headers.update({'Cookie':'webdev_app_session='+identity['cookie'],'X-Steadier-Request':'1','Content-Type':'application/json','X-Steadier-Owner':str(identity['id'])});return s
a,b=fixture['identities'];sa,sb=session(a),session(b)
def get(s):
    r=s.get(BASE+'/api/steadier/workspace');assert r.status_code==200,r.status_code;return r.json()
def put(s,w,rev,client='synthetic-device-a',**extra):
    return s.put(BASE+'/api/steadier/workspace',json={'workspace':w,'baseRevision':rev,'clientId':client,'timeZone':'Australia/Adelaide',**extra})
r=requests.get(BASE+'/api/steadier/workspace');assert r.status_code in (401,403)
assert requests.get(BASE+'/api/compass/context').status_code in (401,403)
assert requests.get(BASE+'/api/compass/context?token=not-a-key').status_code in (400,401,403)
passed('Anonymous and query-token reads rejected')
record=get(sa)
w=copy.deepcopy(fixture['workspace']);w['tasks'][0]['title']='=Synthetic licence formula'
if record['revision']==0:
 assert record['workspace']['tasks']==[]
 r=put(sa,w,0);assert r.status_code==200,r.text;record=r.json()
assert record['revision']==1 and record['workspace']['tasks'][0]['id']==w['tasks'][0]['id']
assert get(sb)['workspace']['tasks']==[]
passed('Server saves complete v2 data and isolates different authenticated owners')
r=sa.put(BASE+'/api/steadier/workspace',headers={'X-Steadier-Request':''},json={'workspace':w,'baseRevision':1,'clientId':'synthetic-device-a'})
assert r.status_code in (400,403)
r=put(sa,{'version':2},1);assert r.status_code==400
r=put(sa,w,0,client='synthetic-device-laptop');assert r.status_code==409
assert get(sa)['revision']==1
passed('Malformed, cross-site-header and stale-revision writes cannot replace saved records')
r=sa.post(BASE+'/api/steadier/compass-keys',json={'label':'Synthetic read-only Compass'});assert r.status_code in (200,201),r.text
key=r.json();token=key['token'];keyid=key['info']['id']
headers={'Authorization':'Bearer '+token}
r=requests.get(BASE+'/api/compass/context',headers=headers);assert r.status_code==200,r.text
context=r.json();assert w['tasks'][0]['id'] in json.dumps(context)
assert 'support' in json.dumps(context) and 'timely' in json.dumps(context)
assert 'Australia/Adelaide' in json.dumps(context) and 'revision' in json.dumps(context)
assert 'no-store' in r.headers.get('Cache-Control','')
r=requests.get(BASE+'/api/compass/sheet.csv',headers=headers);assert r.status_code==200 and 'text/csv' in r.headers.get('Content-Type','')
rows=list(csv.DictReader(io.StringIO(r.text.lstrip('\ufeff'))));assert any(v.startswith("'=Synthetic") for row in rows for v in row.values() if isinstance(v,str))
passed('Read-only AI context and full sheet preserve identity, local planning timezone, freshness and CSV formula safety')
r=requests.put(BASE+'/api/steadier/workspace',headers={**headers,'X-Steadier-Request':'1','Content-Type':'application/json','X-Steadier-Owner':str(a['id'])},json={'workspace':w,'baseRevision':1,'clientId':'fake-ai'});assert r.status_code in (401,403)
r=sb.delete(BASE+f'/api/steadier/compass-keys/{keyid}');assert r.status_code in (200,403,404)
assert requests.get(BASE+'/api/compass/context',headers=headers).status_code==200
r=sa.delete(BASE+f'/api/steadier/compass-keys/{keyid}');assert r.status_code==200
assert requests.get(BASE+'/api/compass/context',headers=headers).status_code in (401,403)
passed('AI key cannot write; another owner cannot revoke it; revocation removes read access')
w=copy.deepcopy(get(sa)['workspace']);w['focus']={'taskId':w['tasks'][0]['id'],'remaining':600,'duration':600,'running':True,'updatedAt':1761264000000,'step':'Synthetic first step'}
r=put(sa,w,1,claimFocus=True);assert r.status_code==200;r=r.json();assert r['focusOwnerClientId']=='synthetic-device-a'
other=copy.deepcopy(w);other['focus']['remaining']=500
r2=put(sa,other,r['revision'],client='synthetic-device-laptop');assert r2.status_code==409
r2=put(sa,w,r['revision'],client='synthetic-device-laptop',claimFocus=True);assert r2.status_code==200
assert r2.json()['focusOwnerClientId']=='synthetic-device-laptop'
old=get(sa);replacement=copy.deepcopy(old['workspace']);replacement['tasks'][0]['notes']='Synthetic checked replacement';replacement['focus']=None
r=put(sa,replacement,old['revision'],client='synthetic-device-laptop',replacement=True);assert r.status_code==200
recover=sa.get(BASE+'/api/steadier/recoveries');assert recover.status_code==200
assert any(v['workspace']==old['workspace'] for v in recover.json()['copies'])
passed('Focus ownership requires deliberate handover and checked replacement preserves server recovery')

with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    def ctx():
        c=browser.new_context(viewport={'width':1440,'height':1050},accept_downloads=True,timezone_id='Australia/Adelaide')
        c.add_cookies([{'name':'webdev_app_session','value':b['cookie'],'domain':'localhost','path':'/','httpOnly':True,'secure':False,'sameSite':'Lax'}])
        return c
    c1,c2=ctx(),ctx();p1,p2=c1.new_page(),c2.new_page()
    for p in (p1,p2):p.set_default_timeout(15000)
    def nav(p,name):p.locator('.sidebar').get_by_role('button',name=name,exact=True).click()
    def shared(p):
        p.goto(BASE+'/',wait_until='networkidle');nav(p,'Server & Compass')
        p.get_by_role('button',name='Use shared personal space',exact=True).click()
        p.get_by_role('status').filter(has_text='Shared personal space loaded').wait_for()
    p1.goto(BASE+'/',wait_until='networkidle')
    original=copy.deepcopy(fixture['workspace']);original['tasks'][0]['title']='Original synthetic browser collection'
    raw=json.dumps(original)
    p1.evaluate('(raw)=>localStorage.setItem("steadier.workspace.v2.personal",raw)',raw)
    shared(p1)
    assert get(sb)['workspace']['tasks']==[]
    assert p1.evaluate('localStorage.getItem("steadier.workspace.v2.personal")')==raw
    passed('Connecting does not silently upload or overwrite original browser records')
    p1.get_by_role('button',name='Review initial transfer',exact=True).click()
    assert get(sb)['workspace']['tasks']==[]
    p1.get_by_role('alertdialog').get_by_role('button',name='Cancel',exact=True).click()
    assert get(sb)['workspace']['tasks']==[]
    p1.get_by_role('button',name='Review initial transfer',exact=True).click()
    p1.get_by_role('button',name='Upload into empty server space',exact=True).click()
    p1.get_by_role('status').filter(has_text='checked operation completed').wait_for()
    assert get(sb)['workspace']['tasks'][0]['id']==original['tasks'][0]['id']
    assert get(sb)['timeZone']=='Australia/Adelaide'
    assert p1.evaluate('localStorage.getItem("steadier.workspace.v2.personal")')==raw
    shared(p2)
    nav(p2,'Server sheet');assert 'Original synthetic browser collection' in p2.locator('.responsibility-sheet').inner_text()
    passed('Explicit transfer retains IDs and original bytes; a second device reads the same server collection')
    p1.locator('.capture-top').click();p1.get_by_label('Your task or voice transcript').fill('Synthetic clear bench #direction #sustained')
    p1.get_by_label('Next physical step (optional)').fill('Move one box')
    p1.get_by_role('button',name='Save responsibility',exact=True).click()
    p1.locator('.shared-status-strip').filter(has_text='synced').wait_for()
    assert len(get(sb)['workspace']['tasks'])==2
    nav(p2,'Server & Compass');p2.get_by_role('button',name='Refresh / retry sync',exact=True).click()
    p2.get_by_role('status').filter(has_text='Connection checked').wait_for()
    nav(p2,'Server sheet');assert 'Synthetic clear bench' in p2.locator('.responsibility-sheet').inner_text()
    passed('Phone/laptop edits propagate through the shared authenticated server')
    with p2.expect_download() as dl:p2.get_by_role('button',name='Download saved server CSV',exact=True).click()
    dl.value.save_as(str(ROOT/'.webdev/synthetic-server-sheet.csv'))
    p2.set_viewport_size({'width':390,'height':844});assert p2.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
    passed('Authenticated saved sheet downloads and scrolls within a phone layout')
    nav(p1,'All work') if False else p1.locator('.sidebar').get_by_role('button',name='All work',exact=False).click()
    p1.locator('.work-row-main').first.click()
    latest=get(sb);new=copy.deepcopy(latest['workspace']);new['tasks'][0]['notes']='Other-device synthetic edit'
    r=put(sb,new,latest['revision'],client='external-synthetic-device');assert r.status_code==200
    p1.get_by_label('Next physical step',exact=False).fill('Local conflicting next step')
    p1.get_by_role('button',name='Save changes',exact=True).click()
    p1.locator('.shared-status-strip').filter(has_text='conflict').wait_for()
    assert get(sb)['workspace']['tasks'][0]['notes']=='Other-device synthetic edit'
    nav(p1,'Server & Compass');p1.get_by_role('button',name='Review using server version',exact=True).click()
    p1.get_by_role('button',name='Use server version',exact=True).click()
    p1.get_by_role('status').filter(has_text='checked operation completed').wait_for()
    passed('Conflicting device edits preserve the server version until an explicit recovery choice')
    c1.close();c2.close();browser.close()
OUT=ROOT/'docs/test-artifacts';OUT.mkdir(exist_ok=True)
(OUT/'server-smoke-results.json').write_text(json.dumps(results,indent=2)+'\n')
print(f'Completed {len(results)} targeted shared-server checks; synthetic records only.',flush=True)
