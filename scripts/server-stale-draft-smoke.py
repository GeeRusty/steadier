#!/usr/bin/env python3
"""Task/project open-draft races; synthetic account only."""
import copy,json,re
from pathlib import Path
import requests
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];BASE='http://localhost:3000'
u=json.loads((ROOT/'.webdev/server-test-fixtures.json').read_text())['identities'][1]
s=requests.Session();s.headers.update({'Cookie':'webdev_app_session='+u['cookie'],'X-Steadier-Request':'1','Content-Type':'application/json','X-Steadier-Owner':str(u['id'])})
def record():
 r=s.get(BASE+'/api/steadier/workspace');assert r.status_code==200;return r.json()
def external(w,revision):
 r=s.put(BASE+'/api/steadier/workspace',json={'workspace':w,'baseRevision':revision,'clientId':'synthetic-other-draft-device','timeZone':'Australia/Adelaide'});assert r.status_code==200,r.text
out=[]
def passed(n):out.append({'check':n,'result':'passed'});print(n+': passed',flush=True)
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 c=browser.new_context(viewport={'width':1440,'height':1050},accept_downloads=True)
 c.add_cookies([{'name':'webdev_app_session','value':u['cookie'],'domain':'localhost','path':'/','httpOnly':True,'secure':False,'sameSite':'Lax'}]);p=c.new_page();p.set_default_timeout(15000)
 def nav(n):p.locator('.sidebar').get_by_role('button',name=n,exact=True).click()
 p.goto(BASE+'/',wait_until='networkidle');nav('Server & Compass');p.get_by_role('button',name='Use shared personal space',exact=True).click();p.get_by_role('status').filter(has_text='Shared personal space loaded').wait_for()
 nav('Projects & outcomes');p.get_by_role('button',name=re.compile('^Edit project')).first.click()
 d=p.locator('.life-project-dialog');title=d.get_by_label('Project name',exact=True).input_value();d.get_by_label('Project name',exact=True).fill('Local synthetic project draft')
 r=record();w=copy.deepcopy(r['workspace']);project=next(v for v in w['projects'] if v['title']==title);pid=project['id'];project['progress'].append({'at':'2026-10-24T00:00:00.000Z','text':'Other device evidence must stay'});external(w,r['revision'])
 p.evaluate("window.dispatchEvent(new Event('online'))");d.get_by_role('alert').filter(has_text='saved project changed').wait_for();d.get_by_role('button',name='Save project',exact=True).click()
 current=next(v for v in record()['workspace']['projects'] if v['id']==pid);assert current['title']==title and current['progress'][-1]['text']=='Other device evidence must stay';assert d.is_visible()
 with p.expect_download() as dl:d.get_by_role('button',name='Download this project draft',exact=True).click()
 dl.value.save_as(str(ROOT/'.webdev/synthetic-project-draft.json'));assert json.loads((ROOT/'.webdev/synthetic-project-draft.json').read_text())['title']=='Local synthetic project draft'
 d.get_by_role('button',name='Close',exact=True).click();passed('Stale outcome draft cannot erase new server evidence and remains downloadable')
 p.locator('.sidebar').get_by_role('button',name='All work',exact=False).click();p.locator('.work-row-main').first.click();d=p.locator('.task-dialog');title=d.get_by_label('Responsibility',exact=True).input_value();d.get_by_label(re.compile('^Next physical step')).fill('Local synthetic task draft step')
 r=record();w=copy.deepcopy(r['workspace']);task=next(v for v in w['tasks'] if v['title']==title);tid=task['id'];task['notes']='Other device note must stay';external(w,r['revision'])
 p.evaluate("window.dispatchEvent(new Event('online'))");d.get_by_role('alert').filter(has_text='responsibility changed').wait_for();d.get_by_role('button',name='Save changes',exact=True).click()
 assert next(v for v in record()['workspace']['tasks'] if v['id']==tid)['notes']=='Other device note must stay';assert d.is_visible()
 with p.expect_download() as dl:d.get_by_role('button',name='Download this task draft',exact=True).click()
 dl.value.save_as(str(ROOT/'.webdev/synthetic-task-draft.json'));assert json.loads((ROOT/'.webdev/synthetic-task-draft.json').read_text())['nextAction']=='Local synthetic task draft step'
 passed('Stale task draft cannot overwrite refreshed server fields and remains downloadable')
 c.close();browser.close()
(ROOT/'docs/test-artifacts/server-stale-draft-results.json').write_text(json.dumps(out,indent=2)+'\n')
print('Completed two targeted open-draft checks.',flush=True)
