#!/usr/bin/env python3
"""Narrow continuation of server-smoke checks; synthetic test account only."""
import copy,json,re
from pathlib import Path
import requests
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
f=json.loads((ROOT/'.webdev/server-test-fixtures.json').read_text());u=f['identities'][1]
BASE='http://localhost:3000'
s=requests.Session();s.headers.update({'Cookie':'webdev_app_session='+u['cookie'],'X-Steadier-Request':'1','Content-Type':'application/json','X-Steadier-Owner':str(u['id'])})
def server():
 r=s.get(BASE+'/api/steadier/workspace');assert r.status_code==200;return r.json()
results=[]
def passed(name):
 results.append({'check':name,'result':'passed'});print(name+': passed',flush=True)
 (ROOT/'docs/test-artifacts/server-final-flows-results.json').write_text(json.dumps(results,indent=2)+'\n')
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 ctx=browser.new_context(viewport={'width':1440,'height':1050},accept_downloads=True)
 ctx.add_cookies([{'name':'webdev_app_session','value':u['cookie'],'domain':'localhost','path':'/','httpOnly':True,'secure':False,'sameSite':'Lax'}])
 p=ctx.new_page();p.set_default_timeout(15000)
 def nav(name):p.locator('.sidebar').get_by_role('button',name=name,exact=True).click()
 p.goto(BASE+'/',wait_until='networkidle');nav('Server & Compass')
 p.get_by_role('button',name='Use shared personal space',exact=True).click()
 p.get_by_role('status').filter(has_text='Shared personal space loaded').wait_for()
 p.locator('.sidebar').get_by_role('button',name='All work',exact=False).click()
 p.locator('.work-row-main').first.click()
 p.get_by_label(re.compile('^Next physical step')).fill('Local synthetic conflicting next step')
 latest=server();w=copy.deepcopy(latest['workspace']);w['tasks'][0]['notes']='Other-device synthetic edit, kept'
 r=s.put(BASE+'/api/steadier/workspace',json={'workspace':w,'baseRevision':latest['revision'],'clientId':'synthetic-external-device','timeZone':latest['timeZone']});assert r.status_code==200
 p.get_by_role('button',name='Save changes',exact=True).click()
 p.locator('.shared-status-strip').filter(has_text='conflict').wait_for()
 assert server()['workspace']['tasks'][0]['notes']=='Other-device synthetic edit, kept'
 nav('Server & Compass');p.get_by_role('button',name='Review using server version',exact=True).click()
 p.get_by_role('button',name='Use server version',exact=True).click()
 p.get_by_role('status').filter(has_text='checked operation completed').wait_for()
 passed('Conflicting device edits preserve both versions and resolve only by explicit choice')
 p.get_by_label('Key label',exact=True).fill('Synthetic UI key')
 p.locator('.checkbox-line input[type=checkbox]').check()
 p.get_by_role('button',name='Create 90-day read-only key',exact=True).click()
 keyfield=p.get_by_label('New private key',exact=True);keyfield.wait_for();token=keyfield.input_value()
 assert token.startswith('stdr_') and requests.get(BASE+'/api/compass/context',headers={'Authorization':'Bearer '+token}).status_code==200
 assert not p.evaluate('(token)=>JSON.stringify(localStorage).includes(token)',token)
 p.locator('.key-row').filter(has_text='Synthetic UI key').get_by_role('button',name='Revoke',exact=True).click()
 p.get_by_role('button',name='Revoke this key',exact=True).click()
 p.get_by_role('status').filter(has_text='Key revoked').wait_for()
 assert requests.get(BASE+'/api/compass/context',headers={'Authorization':'Bearer '+token}).status_code in (401,403)
 passed('UI issues read-only key once without browser persistence and successfully revokes it')
 before=len(server()['workspace']['tasks']);ctx.set_offline(True)
 p.locator('.capture-top').click();p.get_by_label('Your task or voice transcript').fill('Synthetic offline responsibility')
 p.get_by_role('button',name='Save responsibility',exact=True).click()
 p.locator('.shared-status-strip').filter(has_text='offline').wait_for()
 assert len(server()['workspace']['tasks'])==before
 cache=p.evaluate('(id)=>JSON.parse(localStorage.getItem("steadier.cloud.v1.user."+id))',u['id'])
 assert cache['pending'] is not None and len(cache['pending']['workspace']['tasks'])==before+1
 ctx.set_offline(False)
 p.locator('.shared-status-strip').filter(has_text='synced').wait_for()
 assert len(server()['workspace']['tasks'])==before+1
 passed('Offline edit is recoverably pending, excluded from server context, then confirmed after reconnect')
 ctx.close();browser.close()
print(f'Completed {len(results)} targeted remaining server flows.',flush=True)
