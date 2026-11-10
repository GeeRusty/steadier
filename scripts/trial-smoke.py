#!/usr/bin/env python3
"""Personal trial checks in fresh browser stores; never reads the user's browser data."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/test-artifacts'
OUT.mkdir(parents=True, exist_ok=True)
checks=[]
def record(name, detail):
    checks.append({'check':name,'result':detail});print(name+': '+detail,flush=True)
def saved(page):
    return page.evaluate("JSON.parse(localStorage.getItem('steadier.workspace.v2.personal'))")
def nav(page, name):
    page.locator('.sidebar').get_by_role('button',name=name,exact=True).click()
def no_overflow(page):
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
LEGACY_KEYS=['id','title','area','nextAction','notes','state','important','pinned','deadline','startDate','reviewDate','deferredUntil','estimate','context','waitingFor','dependencies','checklist','repeatDays','createdAt','updatedAt','completedAt','history']
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    ctx=browser.new_context(viewport={'width':1440,'height':1050},accept_downloads=True)
    page=ctx.new_page();page.set_default_timeout(10000)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto('http://localhost:3000/',wait_until='networkidle')
    page.locator('.workspace-switch').click()
    nav(page,'Projects & outcomes')
    page.get_by_role('button',name='Add project',exact=True).click()
    page.get_by_label('Project name',exact=True).fill('A usable garage workspace')
    page.get_by_label('Project purpose',exact=True).fill('Make everyday repairs easier to begin')
    page.get_by_label('Project outcome',exact=True).fill('A clear accessible work surface')
    page.get_by_label('Project role',exact=True).select_option('direction')
    page.get_by_label('Project pattern',exact=True).select_option('sustained')
    page.get_by_role('button',name='Create project',exact=True).click()
    project=saved(page)['projects'][0]
    page.get_by_label('New milestone for A usable garage workspace').fill('One clear bench')
    page.locator('.life-project-section').filter(has_text='MILESTONES').get_by_role('button',name='Add',exact=True).click()
    page.get_by_label('Mark milestone One clear bench complete').check()
    page.get_by_label('Observed evidence for A usable garage workspace').fill('Tools now have an accessible home')
    page.get_by_role('button',name='Save evidence',exact=True).click()
    assert saved(page)['projects'][0]['status']=='active'
    record('Outcome and evidence','milestone/evidence saved without falsely achieving the project')
    page.get_by_role('button',name='Add small task',exact=True).click()
    page.get_by_label('Your task or voice transcript').fill('Clear bench #direction #sustained')
    page.get_by_label('Next physical step (optional)').fill('Move one box onto the shelf')
    page.get_by_role('button',name='Save responsibility',exact=True).click()
    task=saved(page)['tasks'][0]
    assert task['projectId']==project['id'] and task['purpose']==project['purpose']
    assert task['role']=='direction' and task['pattern']=='sustained'
    record('Linked responsibility','capture holds its purpose, role/pattern and outcome link')
    nav(page,'My life matrix')
    page.get_by_label('Emphasis for Support · Sustained',exact=True).select_option('2')
    assert saved(page)['matrixWeights']['support-sustained']==2
    record('Matrix emphasis','chosen setting persists; role is not a value ranking')
    nav(page,'My life today')
    page.get_by_label('What have I chosen with Compass?',exact=True).fill('Give the garage outcome two minutes of engagement')
    page.get_by_label('Optional saved next task',exact=True).select_option(task['id'])
    page.get_by_role('button',name='Save today’s intention',exact=True).click()
    page.get_by_role('button',name='Return to chosen task',exact=True).click()
    page.get_by_role('button',name='Pause',exact=True).click()
    page.get_by_role('button',name='Close',exact=True).click()
    page.reload(wait_until='networkidle')
    assert saved(page)['intention']['taskId']==task['id']
    assert saved(page)['focus']['taskId']==task['id'] and saved(page)['focus']['running'] is False
    record('Remembered intention and re-entry','Compass wording, chosen step and paused focus survive reload')
    nav(page,'Backups & trial')
    with page.expect_download() as dl:
        page.get_by_role('button',name='Download full backup',exact=True).click()
    download=dl.value
    backup_path=OUT/'synthetic-trial-backup.json';download.save_as(str(backup_path))
    backup=json.loads(backup_path.read_text())
    if 'workspace' in backup: backup=backup['workspace']
    assert backup['version']==2
    assert backup['tasks'][0]['projectId']==backup['projects'][0]['id']
    assert backup['intention']['taskId']==backup['focus']['taskId']==task['id']
    assert backup['projects'][0]['milestones'][0]['done'] is True
    assert backup['projects'][0]['progress'][0]['text']=='Tools now have an accessible home'
    assert saved(page)['trial']['lastExportAt'] is not None
    record('Full dated backup','download contains identities, project/milestone/evidence, weights, intention and focus')
    assert 'browser cannot confirm' in page.locator('.settings-section').filter(has=page.locator('#backup-heading')).inner_text()
    file_input=page.locator('input[type=file]').first
    invalid=json.dumps({'version':2,'tasks':[]})
    file_input.set_input_files({'name':'invalid.json','mimeType':'application/json','buffer':invalid.encode()})
    page.get_by_role('alert').filter(has_text='Nothing was replaced').wait_for()
    assert saved(page)['tasks'][0]['id']==task['id']
    record('Invalid backup rejection','malformed workspace rejected without replacing live records')
    # Make a real change in the synthetic personal store, then restore exactly.
    page.locator('.capture-top').click()
    page.get_by_label('Your task or voice transcript').fill('Extra synthetic responsibility')
    page.get_by_role('button',name='Save responsibility',exact=True).click()
    before=saved(page)
    file_input.set_input_files(str(backup_path))
    page.get_by_role('alertdialog').wait_for()
    assert len(saved(page)['tasks'])==2
    page.get_by_role('alertdialog').get_by_role('button',name='Cancel',exact=True).click()
    assert len(saved(page)['tasks'])==2
    record('Restore preflight and cancel','selection alone does not change data; cancel preserves it')
    file_input.set_input_files(str(backup_path))
    page.get_by_role('button',name='Replace personal workspace',exact=True).click()
    restored=saved(page)
    assert restored==backup, (restored,backup)
    copies=page.evaluate("JSON.parse(localStorage.getItem('steadier.workspace.v2.personal.recovery'))")
    assert any(c['workspace']['tasks']==before['tasks'] for c in copies)
    record('Exact full restore','original IDs and all workspace fields restored; pre-restore collection recoverable locally')
    nav(page,'Projects & outcomes')
    page.locator('.life-linked-task').first.click()
    page.get_by_label('Responsibility progress evidence',exact=True).fill('Bench cleared and ready for use')
    page.get_by_role('button',name='Mark responsibility complete',exact=True).click()
    w=saved(page)
    assert w['tasks'][0]['state']=='done'
    assert w['projects'][0]['progress'][-1]['text']=='Bench cleared and ready for use'
    assert w['projects'][0]['status']=='active'
    record('Meaningful completion','draft evidence is retained and contributes to outcome without claiming achievement')
    page.set_viewport_size({'width':390,'height':844})
    no_overflow(page)
    page.screenshot(path=str(OUT/'trial-project-phone.png'),full_page=True)
    page.locator('.mobile-bottom').get_by_role('button',name='Backups',exact=True).click()
    no_overflow(page)
    page.set_viewport_size({'width':320,'height':700});no_overflow(page)
    record('Trial phone layouts','projects and backup/restore controls reflow at 390px and 320px')
    assert not errors,errors
    ctx.close()
    # Upgrade actual v1-shaped data in a separate new synthetic browser store.
    legacy_task={k:task[k] for k in LEGACY_KEYS}
    legacy_task['notes']='Legacy notes must survive exactly'
    legacy={'version':1,'tasks':[legacy_task],'focus':None}
    raw=json.dumps(legacy,separators=(',',':'))
    lc=browser.new_context()
    lp=lc.new_page();lp.goto('http://localhost:3000/',wait_until='networkidle')
    lp.evaluate('(raw)=>{localStorage.clear();localStorage.setItem("steadier.workspace.v1.personal",raw);localStorage.setItem("steadier.preferred","personal");}',raw)
    lp.reload(wait_until='networkidle')
    migrated=saved(lp)
    assert migrated['version']==2 and migrated['tasks'][0]['id']==task['id']
    assert migrated['tasks'][0]['notes']==legacy_task['notes']
    assert migrated['tasks'][0]['role'] is None and migrated['tasks'][0]['projectId'] is None
    assert lp.evaluate('localStorage.getItem("steadier.workspace.v1.personal")')==raw
    record('Legacy upgrade','v1 task IDs/notes preserved, neutral fields added, original v1 bytes unchanged')
    lc.close();browser.close()
(OUT/'trial-smoke-results.json').write_text(json.dumps(checks,indent=2)+'\n')
print(f'Completed {len(checks)} personal-trial checks; synthetic records only.',flush=True)
