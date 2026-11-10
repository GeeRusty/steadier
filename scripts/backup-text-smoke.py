#!/usr/bin/env python3
"""Phone backup fallback checks. Synthetic stores/API replies only; no real user records."""
import copy
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SOURCE = json.loads((ROOT / '.webdev/backup-text-source.json').read_text())
TARGET = json.loads((ROOT / '.webdev/backup-text-target.json').read_text())
KEY = 'steadier.workspace.v2.personal'
checks = []


def check(condition, label):
    assert condition, label
    checks.append(label)
    print('PASS:', label, flush=True)


def nav(page, name):
    page.locator('.sidebar').get_by_role('button', name=name, exact=True).click()


def saved(page):
    return page.evaluate(f"JSON.parse(localStorage.getItem('{KEY}'))")


def setup(context, workspace=SOURCE):
    context.route('**/__manus__/debug-collector.js', lambda route: route.fulfill(status=200, content_type='application/javascript', body=''))
    context.add_init_script(f"localStorage.setItem('{KEY}',{json.dumps(json.dumps(workspace))});")
    context.add_init_script("""
      Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw new Error('Synthetic clipboard denial');},readText:()=>{throw new Error('Clipboard must not be read');}}});
      document.execCommand=()=>false;
      window.__backupSpeech=[];window.__backupStops=0;
      Object.defineProperty(window,'SpeechSynthesisUtterance',{value:function(text){this.text=text;}});
      Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[],speak:(u)=>{window.__backupSpeech.push(u.text);u.onstart?.();},cancel:()=>{window.__backupStops++;}}});
    """)


with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width':1440,'height':1050})
    setup(context)
    page = context.new_page()
    page.set_default_timeout(10000)
    page.goto('http://localhost:3000/', wait_until='domcontentloaded')
    page.locator('.workspace-switch').click()
    nav(page, 'Backups & trial')
    original = saved(page)
    page.get_by_role('button', name='Copy backup text', exact=True).click()
    shown = page.get_by_label('Full backup JSON', exact=True)
    shown.wait_for()
    check(json.loads(shown.input_value()) == original, 'clipboard denial exposes complete exact private backup text')
    page.get_by_role('button', name='Select all backup text', exact=True).click()
    check(shown.evaluate('(e)=>e.selectionStart===0&&e.selectionEnd===e.value.length'), 'manual select-all covers the entire backup')
    check(saved(page) == original, 'copy/show fallback does not mutate original collection')
    page.get_by_role('button', name='Read backup help aloud', exact=True).click()
    check(page.evaluate('window.__backupSpeech.some(t=>t.includes("Nothing is replaced"))'), 'backup guidance read-aloud is explicit and contains no raw JSON')
    page.locator('[aria-labelledby="backup-heading"]').get_by_role('button', name='Stop reading', exact=True).click()
    check(page.evaluate('window.__backupStops>0'), 'backup-help speech has explicit stop')
    page.get_by_role('button', name='Hide backup text', exact=True).click()
    page.evaluate("() => { URL.createObjectURL=()=>{throw new Error('Synthetic blocked download');}; }")
    page.get_by_role('button', name='Download full backup', exact=True).click()
    shown.wait_for()
    page.get_by_role('alert').filter(has_text='could not start the download').wait_for()
    check(saved(page) == original, 'blocked download does not turn preparation into a mutation or saved-file claim')

    page.get_by_role('button', name='Restore from backup text', exact=True).click()
    paste = page.get_by_label('Full backup text to check', exact=True)
    paste.fill('not a valid JSON backup')
    page.get_by_role('button', name='Check pasted backup', exact=True).click()
    page.get_by_role('alert').filter(has_text='Nothing was replaced').wait_for()
    check(saved(page) == original, 'invalid pasted backup changes nothing')
    paste.fill(json.dumps(TARGET))
    page.get_by_role('button', name='Check pasted backup', exact=True).click()
    candidate = page.get_by_role('alertdialog')
    candidate.wait_for()
    check(saved(page) == original, 'valid pasted backup is preview only before confirmation')
    candidate.get_by_role('button', name='Cancel', exact=True).click()
    check(saved(page) == original, 'canceling pasted restore leaves all original records intact')
    page.get_by_role('button', name='Restore from backup text', exact=True).click()
    paste.fill(json.dumps(TARGET))
    page.get_by_role('button', name='Check pasted backup', exact=True).click()
    page.get_by_role('button', name='Replace personal workspace', exact=True).click()
    page.wait_for_function(f"JSON.parse(localStorage.getItem('{KEY}')).tasks[0].title==='Synthetic restored responsibility'")
    check(saved(page) == TARGET, 'confirmed pasted restore preserves exact IDs/projects/links/weights and metadata')
    nav(page, 'Backups & trial')
    page.get_by_role('button', name='Restore from backup text', exact=True).click()
    paste.fill(json.dumps(SOURCE))
    page.locator('.workspace-switch').click()
    nav(page, 'Backups & trial')
    check(page.get_by_label('Full backup text to check', exact=True).count() == 0, 'scope change clears private paste text and candidates')
    page.set_viewport_size({'width':390,'height':844})
    check(page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'), 'backup controls fit a phone viewport')
    context.close()

    # UI-only shared-space simulation; authorization implementation is unchanged.
    empty = copy.deepcopy(SOURCE)
    empty['tasks'] = []
    empty['projects'] = []
    empty['focus'] = None
    empty['intention'] = None
    server = {'workspace':empty,'revision':0,'updatedAt':None,'timeZone':'UTC','focusOwnerClientId':None}
    puts = []
    context = browser.new_context(viewport={'width':1440,'height':1050},timezone_id='Australia/Adelaide')
    setup(context)

    def api(route):
        nonlocal_record = server
        path = route.request.url.split('/api/steadier/',1)[1].split('?')[0]
        if path == 'session':
            route.fulfill(status=200,json={'user':{'id':42,'name':'Synthetic UI test'}})
        elif path == 'workspace' and route.request.method == 'GET':
            route.fulfill(status=200,json=nonlocal_record)
        elif path == 'workspace' and route.request.method == 'PUT':
            payload = route.request.post_data_json
            puts.append(payload)
            server.update({'workspace':payload['workspace'],'revision':server['revision']+1,'updatedAt':'2026-10-24T05:00:00.000Z','timeZone':payload['timeZone'],'focusOwnerClientId':None})
            route.fulfill(status=200,json=server)
        elif path == 'compass-keys':
            route.fulfill(status=200,json={'keys':[]})
        else:
            route.fulfill(status=503,json={'message':'Synthetic recovery service temporarily unavailable.'})

    context.route('**/api/steadier/**',api)
    page = context.new_page()
    page.set_default_timeout(10000)
    page.goto('http://localhost:3000/',wait_until='domcontentloaded')
    nav(page,'Server & Compass')
    page.get_by_role('button',name='Use shared personal space',exact=True).click()
    page.get_by_text('Shared personal space loaded.',exact=False).wait_for()
    nav(page,'Backups & trial')
    page.get_by_role('button',name='Restore from backup text',exact=True).click()
    page.get_by_label('Full backup text to check',exact=True).fill(json.dumps(TARGET))
    page.get_by_role('button',name='Check pasted backup',exact=True).click()
    check(len(puts)==0,'checking pasted text never sends a shared-server replacement')
    page.get_by_role('button',name='Replace personal workspace',exact=True).click()
    page.wait_for_function("document.body.innerText.includes('Backup restored')")
    check(len(puts)==1 and server['workspace']==TARGET,'shared pasted restore uses one confirmed full-workspace write')
    check(puts[0]['baseRevision']==0 and puts[0]['replacement'] is True,'shared pasted restore retains revision and replacement guards')
    check(server['timeZone']=='Australia/Adelaide','first saved shared backup uses Adelaide planning timezone, not empty UTC placeholder')
    context.close()
    browser.close()

(ROOT/'.webdev/backup-text-ui-results.json').write_text(json.dumps({'checks':checks,'actualOwnerDataRead':False,'actualServerRecordsWritten':False},indent=2)+'\n')
print('All targeted text backup checks passed with synthetic data only.',flush=True)
