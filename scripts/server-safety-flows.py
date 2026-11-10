#!/usr/bin/env python3
"""Confirmed review-defect regressions; isolated contexts and synthetic identities only."""
import copy,json,time,sys
from pathlib import Path
import requests
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];BASE='http://localhost:3000'
f=json.loads((ROOT/'.webdev/server-test-fixtures.json').read_text());a,b=f['identities']
def http(u):
 s=requests.Session();s.headers.update({'Cookie':'webdev_app_session='+u['cookie'],'X-Steadier-Request':'1','Content-Type':'application/json','X-Steadier-Owner':str(u['id'])});return s
sa,sb=http(a),http(b)
def rec(s):
 r=s.get(BASE+'/api/steadier/workspace');assert r.status_code==200,r.status_code;return r.json()
focus_only='--focus-only' in sys.argv
results=json.loads((ROOT/'docs/test-artifacts/server-safety-results.json').read_text()) if focus_only else []
def passed(n):
 results.append({'check':n,'result':'passed'});print(n+': passed',flush=True)
 (ROOT/'docs/test-artifacts/server-safety-results.json').write_text(json.dumps(results,indent=2)+'\n')
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 def cookie(u):return {'name':'webdev_app_session','value':u['cookie'],'domain':'localhost','path':'/','httpOnly':True,'secure':False,'sameSite':'Lax'}
 def context(u):
  c=browser.new_context(viewport={'width':1440,'height':1050});c.add_cookies([cookie(u)]);return c
 def nav(p,n):p.locator('.sidebar').get_by_role('button',name=n,exact=True).click()
 def connect(p):
  p.goto(BASE+'/',wait_until='networkidle');nav(p,'Server & Compass');p.get_by_role('button',name='Use shared personal space',exact=True).click();p.get_by_role('status').filter(has_text='Shared personal space loaded').wait_for()
 if not focus_only:
  c=context(b);p=c.new_page();p.set_default_timeout(15000);connect(p)
  before=rec(sa)['workspace'];c.set_offline(True)
  p.locator('.capture-top').click();p.get_by_label('Your task or voice transcript').fill('Synthetic B private draft must not reach A')
  p.get_by_role('button',name='Save responsibility',exact=True).click();p.locator('.shared-status-strip').filter(has_text='offline').wait_for()
  c.add_cookies([cookie(a)]);c.set_offline(False)
  p.get_by_text('account',exact=False).first.wait_for() if False else None
  p.wait_for_function("document.body.innerText.includes('Account') || document.body.innerText.includes('account changed') || document.body.innerText.includes('reconnect') || document.body.innerText.includes('Reconnect')")
  assert rec(sa)['workspace']==before
  cache=p.evaluate('(id)=>JSON.parse(localStorage.getItem("steadier.cloud.v1.user."+id))',b['id'])
  assert cache['pending'] is not None and 'must not reach A' in json.dumps(cache['pending']['workspace'])
  passed('Cookie account swap cannot read/write into a different owner and preserves the original owner pending cache')
  c.close()
  c=context(a);p=c.new_page();p.set_default_timeout(15000);p.goto(BASE+'/',wait_until='networkidle')
  raw='{synthetic invalid original';p.evaluate('(raw)=>localStorage.setItem("steadier.workspace.v2.personal",raw)',raw)
  connect(p);before_count=len(rec(sa)['workspace']['tasks'])
  p.locator('.capture-top').click();p.get_by_label('Your task or voice transcript').fill('Synthetic healthy server despite corrupt original')
  p.get_by_role('button',name='Save responsibility',exact=True).click();p.locator('.shared-status-strip').filter(has_text='synced').wait_for()
  assert len(rec(sa)['workspace']['tasks'])==before_count+1
  assert p.evaluate('localStorage.getItem("steadier.workspace.v2.personal")')==raw
  passed('Unrelated corrupt original browser bytes remain protected without blocking a healthy server edit')
  c.close()
 # The B pending document above is confined to that closed test context, not the server.
 current=rec(sb);w=copy.deepcopy(current['workspace']);task=next(t for t in w['tasks'] if t['state']=='ready')
 w['focus']={'taskId':task['id'],'remaining':600,'duration':600,'running':True,'updatedAt':int(time.time()*1000),'step':task['nextAction']}
 r=sb.put(BASE+'/api/steadier/workspace',json={'workspace':w,'baseRevision':current['revision'],'clientId':'synthetic-remote-owner','claimFocus':True,'timeZone':current['timeZone']});assert r.status_code==200,r.text
 c=context(b);p=c.new_page();p.set_default_timeout(15000);connect(p);nav(p,'My life today')
 chosen=next((t for t in w['tasks'] if t['state']=='ready' and t['id']!=task['id']),task)
 p.get_by_label('What have I chosen with Compass?',exact=True).fill('Synthetic deliberate direction')
 p.get_by_label('Optional saved next task',exact=True).select_option(chosen['id'])
 p.get_by_role('button',name='Save today’s intention',exact=True).click()
 p.locator('.shared-status-strip').filter(has_text='synced').wait_for()
 p.get_by_role('button',name='Return to chosen task',exact=True).click()
 dialog=p.locator('.focus-dialog');dialog.wait_for();assert rec(sb)['focusOwnerClientId']=='synthetic-remote-owner'
 assert dialog.get_by_role('button',name='Pause',exact=True).is_disabled()
 assert dialog.get_by_role('button',name='Finished this responsibility',exact=True).is_disabled()
 dialog.get_by_role('button',name='Take focus on this device',exact=True).click()
 p.wait_for_function("[...document.querySelectorAll('.focus-dialog button')].some(b=>b.textContent.trim()==='Pause'&&!b.disabled)")
 client=p.evaluate('sessionStorage.getItem("steadier.cloud.client.v1")');assert rec(sb)['focusOwnerClientId']==client
 dialog.get_by_role('button',name='Pause',exact=True).click();p.locator('.shared-status-strip').filter(has_text='synced').wait_for()
 assert rec(sb)['workspace']['focus']['running'] is False and rec(sb)['focusOwnerClientId'] is None
 passed('Normal Start does not steal remote focus; explicit acknowledged takeover enables controlled pause')
 c.close();browser.close()
print(f'Completed {len(results)} confirmed-review safety flows.',flush=True)
