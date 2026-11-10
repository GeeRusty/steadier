#!/usr/bin/env python3
"""Targeted review regressions using only the previous smoke run's synthetic backup."""
import copy,json,time
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs/test-artifacts'
backup=json.loads((OUT/'synthetic-trial-backup.json').read_text())
backup=backup.get('workspace',backup)
checks=[]
def record(name):
    checks.append({'check':name,'result':'passed'});print(name+': passed',flush=True)
def nav(p,name):
    p.locator('.sidebar').get_by_role('button',name=name,exact=True).click()
def seed(p,personal,demo=None,preferred='personal'):
    p.goto('http://localhost:3000/',wait_until='networkidle')
    p.evaluate('(v)=>{localStorage.clear();localStorage.setItem("steadier.workspace.v2.personal",JSON.stringify(v.personal));if(v.demo)localStorage.setItem("steadier.workspace.v2.demo",JSON.stringify(v.demo));localStorage.setItem("steadier.preferred",v.preferred)}',{'personal':personal,'demo':demo,'preferred':preferred})
    p.reload(wait_until='networkidle')
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    ctx=browser.new_context(viewport={'width':1440,'height':1050},accept_downloads=True)
    p=ctx.new_page();p.set_default_timeout(10000)
    seed(p,backup)
    nav(p,'Backups & trial')
    file_input=p.locator('input[type=file]').first
    good={'name':'good.json','mimeType':'application/json','buffer':json.dumps(backup).encode()}
    bad={'name':'bad.json','mimeType':'application/json','buffer':b'{"version":2}'}
    file_input.set_input_files(good);p.get_by_role('alertdialog').wait_for()
    file_input.set_input_files(bad)
    p.get_by_role('alert').filter(has_text='Nothing was replaced').wait_for()
    assert p.get_by_role('alertdialog').count()==0
    record('Malformed new selection invalidates old destructive candidate')
    p.evaluate('''()=>{const original=File.prototype.text;File.prototype.text=function(){const f=this;return original.call(this).then(text=>f.name==='slow.json'?new Promise(resolve=>setTimeout(()=>resolve(text),900)):text)}}''')
    file_input.set_input_files({**good,'name':'slow.json'})
    file_input.set_input_files({**good,'name':'fast.json'})
    p.get_by_role('alertdialog').wait_for()
    p.wait_for_timeout(1100)
    assert 'fast.json' in p.get_by_role('alertdialog').inner_text()
    assert 'slow.json' not in p.get_by_role('alertdialog').inner_text()
    p.get_by_role('alertdialog').get_by_role('button',name='Cancel',exact=True).click()
    record('Overlapping restore reads remain bound to latest selection')
    proposed=copy.deepcopy(backup)
    proposed['focus']=None
    t=proposed['tasks'][0]
    t.update({'title':'Renew tool licence','role':'support','pattern':'timely','labelSource':'suggested','state':'ready','completedAt':None,'deadline':'2030-12-01','preparationDate':'2030-11-24','preparationSource':'suggested'})
    seed(p,proposed)
    nav(p,'All work') if False else p.locator('.sidebar').get_by_role('button',name='All work',exact=False).click()
    p.locator('.work-row-main').first.click()
    p.get_by_label('Responsibility role',exact=True).select_option('direction')
    p.get_by_role('button',name='Save changes',exact=True).click()
    assert p.evaluate('JSON.parse(localStorage.getItem("steadier.workspace.v2.personal")).tasks[0].labelSource')=='suggested'
    p.locator('.work-row-main').first.click()
    p.get_by_role('button',name='Use this identity',exact=True).click()
    p.get_by_role('button',name='Save changes',exact=True).click()
    assert p.evaluate('JSON.parse(localStorage.getItem("steadier.workspace.v2.personal")).tasks[0].labelSource')=='confirmed'
    record('Partial provisional edit stays provisional until explicit confirmation')
    # Old timer and new workspace deliberately share a task ID: validation alone
    # would not prevent this stale callback from replacing the new focus record.
    tc=browser.new_context()
    tc.add_init_script('''(()=>{const original=window.setInterval;window.setInterval=(fn,delay,...args)=>{if(delay===1000)window.__focusTick=fn;return original(fn,delay,...args)}})()''')
    tp=tc.new_page()
    personal=copy.deepcopy(backup);demo=copy.deepcopy(backup)
    personal['focus'].update({'running':False,'step':'PERSONAL place must remain','updatedAt':int(time.time()*1000)})
    demo['focus'].update({'running':True,'step':'OLD DEMO timer','updatedAt':int(time.time()*1000)})
    seed(tp,personal,demo,'demo')
    tp.wait_for_function('typeof window.__focusTick === "function"')
    tp.evaluate('''()=>{const callback=window.__focusTick;const original=Date.now;Date.now=()=>original()+2000;document.querySelector('.workspace-switch').click();callback();Date.now=original}''')
    current=tp.evaluate('JSON.parse(localStorage.getItem("steadier.workspace.v2.personal"))')
    assert current['focus']['step']=='PERSONAL place must remain'
    assert current['focus']['running'] is False
    record('Captured old focus tick cannot write into selected workspace')
    tc.close()
    legacy_keys=['id','title','area','nextAction','notes','state','important','pinned','deadline','startDate','reviewDate','deferredUntil','estimate','context','waitingFor','dependencies','checklist','repeatDays','createdAt','updatedAt','completedAt','history']
    legacy_task={key:backup['tasks'][0][key] for key in legacy_keys}
    legacy_task['createdAt']='legacy-but-not-a-valid-instant'
    raw=json.dumps({'version':1,'tasks':[legacy_task],'focus':None})
    p.evaluate('(raw)=>{localStorage.clear();localStorage.setItem("steadier.workspace.v1.personal",raw);localStorage.setItem("steadier.preferred","personal")}',raw)
    p.reload(wait_until='networkidle')
    p.get_by_role('alert').filter(has_text='It has not been overwritten').wait_for()
    assert p.evaluate('localStorage.getItem("steadier.workspace.v1.personal")')==raw
    assert p.evaluate('localStorage.getItem("steadier.workspace.v2.personal")') is None
    nav(p,'Backups & trial')
    assert p.get_by_role('button',name='Download full backup',exact=True).is_disabled()
    assert p.get_by_role('button',name='Download raw saved data',exact=True).is_enabled()
    record('Unconvertible legacy data protected without invalid v2 write or misleading full backup')
    ctx.close();browser.close()
(OUT/'trial-edge-results.json').write_text(json.dumps(checks,indent=2)+'\n')
print(f'Completed {len(checks)} targeted safety regressions.',flush=True)
