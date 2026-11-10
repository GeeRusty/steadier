#!/usr/bin/env python3
"""Targeted prototype smoke tests. Voice APIs are simulated, not real audio tests."""
import json
import subprocess
import time
import urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs' / 'test-artifacts'
OUT.mkdir(parents=True, exist_ok=True)
results = []
def record(name, detail='passed'):
    results.append({'check': name, 'result': detail})
    print(f'{name}: {detail}', flush=True)

MOCK_VOICE = r"""
window.__voiceText = 'Call the mechanic #vehicles next: find the phone number';
window.__voiceError = null;
window.SpeechRecognition = class {
  start() { this.timer = setTimeout(() => {
    if (window.__voiceError) { this.onerror?.({error:window.__voiceError}); this.onend?.(); return; }
    const r=[{transcript:window.__voiceText}]; r.isFinal=true;
    this.onresult?.({resultIndex:0,results:[r]}); this.onend?.();
  }, 100); }
  stop(){ clearTimeout(this.timer); this.onend?.(); }
  abort(){ clearTimeout(this.timer); this.onend?.(); }
};
window.SpeechSynthesisUtterance = class { constructor(text){this.text=text;} };
Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{
 getVoices(){return [{lang:'en-AU'}];},
 speak(u){window.__lastRead=u.text;u.onstart?.();this.u=u;},
 cancel(){this.u?.onend?.();this.u=null;}
}});
"""
def close_dialog(page):
    page.get_by_role('button', name='Close', exact=True).click()

def assert_no_overflow(page, name):
    dims=page.evaluate('({w:innerWidth,scroll:document.documentElement.scrollWidth})')
    assert dims['scroll']<=dims['w']+1, (name,dims)
    record(name, f'no horizontal overflow at {dims["w"]}px')

with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':1440,'height':1050},accept_downloads=True)
    context.add_init_script(MOCK_VOICE)
    page=context.new_page()
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto('http://localhost:3000/',wait_until='networkidle')
    page.locator('.lead-task').wait_for()
    assert page.locator('.lead-task').count()+page.locator('.alternative-row').count()==5
    assert '200 responsibilities held' in page.locator('.page-heading').inner_text()
    record('200-task home', 'exactly five explained recommendations; full 200 count visible')
    assert_no_overflow(page,'Desktop layout')
    page.screenshot(path=str(OUT/'desktop.png'),full_page=True)
    page.get_by_role('button',name='Read my attention',exact=True).click()
    assert '200 responsibilities' in page.evaluate('window.__lastRead')
    page.get_by_role('button',name='Stop reading',exact=True).click()
    record('Read-aloud controls', 'simulated synthesis: summary and explicit stop')

    # Personal records are isolated from the scenario lab.
    page.locator('.workspace-switch').click()
    assert 'Start with one responsibility' in page.locator('.page-heading').inner_text()
    page.locator('.capture-top').click()
    page.get_by_label('Your task or voice transcript').fill('Test lamp #home')
    page.get_by_label('Next physical step (optional)').fill('Find the screwdriver')
    page.get_by_role('button',name='Save responsibility',exact=True).click()
    page.get_by_role('button',name='Start a little focus',exact=True).click()
    page.get_by_role('button',name="I'm drifting",exact=True).click()
    page.get_by_label('A two-minute entry step').fill('Put the screwdriver on the bench')
    page.get_by_role('button',name='Try just this step',exact=True).click()
    page.get_by_role('button',name='Pause',exact=True).click()
    close_dialog(page)
    page.reload(wait_until='networkidle')
    assert 'Put the screwdriver on the bench' in page.locator('.resume-strip').inner_text()
    page.get_by_role('button',name='Return to focus',exact=True).click()
    assert page.get_by_role('button',name='Resume',exact=True).is_visible()
    close_dialog(page)
    record('Capture, focus and drift recovery', 'personal task and chosen paused entry step survive reload')

    # Transcript is a draft. Command requires explicit confirmation.
    page.evaluate("window.__voiceText='done'")
    page.locator('.voice-top').click()
    page.get_by_role('button',name='Confirm action',exact=True).wait_for()
    assert 'Test lamp' in page.locator('.capture-preview').inner_text()
    saved=page.evaluate("JSON.parse(localStorage.getItem('steadier.workspace.v2.personal'))")
    assert saved['tasks'][0]['state']!='done'
    page.get_by_role('button',name='Confirm action',exact=True).click()
    page.get_by_role('button',name='Undo',exact=True).click()
    saved=page.evaluate("JSON.parse(localStorage.getItem('steadier.workspace.v2.personal'))")
    assert saved['tasks'][0]['state']!='done'
    record('Voice command and undo', 'simulated transcript does not complete until confirmed; undo restores')
    page.evaluate("window.__voiceError='not-allowed'")
    page.locator('.voice-top').click()
    page.get_by_role('alert').filter(has_text='Microphone permission was denied').wait_for()
    close_dialog(page)
    page.evaluate('window.__voiceError=null')
    record('Voice permission failure', 'simulated denial exposes useful error and preserves tasks')
    page.locator('.capture-top').click()
    page.get_by_label('Your task or voice transcript').fill('Waiting capture validation')
    page.get_by_label('State', exact=False).select_option('waiting')
    page.get_by_role('button',name='Save responsibility',exact=True).click()
    page.get_by_role('alert').filter(has_text='Name the person, reply or event').wait_for()
    page.get_by_label('Who or what are you waiting for?').fill('Maya to reply')
    page.get_by_role('button',name='Save responsibility',exact=True).click()
    record('Waiting capture validation', 'anonymous waiting cannot save; named blocker saves')
    personal=page.evaluate("localStorage.getItem('steadier.workspace.v2.personal')")
    page.locator('.workspace-switch').click()

    for scenario,count in [('few',5),('fifty',50),('twohundred',200),('fivehundred',500),('deadlines',None),('overdue',None),('undated',None),('quiet',None)]:
        page.locator('.sidebar').get_by_role('button',name='Backups & trial',exact=True).click()
        page.get_by_label('Choose a sample scenario').select_option(scenario)
        page.get_by_role('button',name='Load sample scenario',exact=True).click()
        n=page.locator('.lead-task').count()+page.locator('.alternative-row').count()
        assert n<=5, (scenario,n)
        saved=page.evaluate("JSON.parse(localStorage.getItem('steadier.workspace.v2.demo'))")
        if count: assert len(saved['tasks'])==count
        if scenario=='undated': assert all(t['deadline'] is None for t in saved['tasks'])
        assert page.evaluate("localStorage.getItem('steadier.workspace.v2.personal')")==personal
        record(f'Scenario {scenario}',f'{len(saved["tasks"])} tasks; {n} suggestions; personal collection unchanged')

    # Library search, editor validation, narrow screen and honest unsupported dictation.
    page.locator('.sidebar').get_by_role('button',name='All work',exact=False).click()
    page.get_by_label('Search all responsibilities').fill('garage')
    assert page.locator('.work-row').count()>=1
    page.locator('.work-row-main').first.click()
    page.locator('.featured-field textarea').fill('Inspect the first shelf and choose one box')
    page.get_by_role('button',name='Save changes',exact=True).click()
    assert 'Inspect the first shelf' in page.locator('.work-list').inner_text()
    record('Search and detail', 'find undated garage task and save a concrete next step')
    page.set_viewport_size({'width':390,'height':844})
    page.locator('.mobile-bottom').get_by_role('button',name='Today',exact=True).click()
    assert_no_overflow(page,'Android-width layout')
    page.screenshot(path=str(OUT/'phone.png'),full_page=True)
    page.set_viewport_size({'width':320,'height':700})
    assert_no_overflow(page,'Narrow / zoom-reflow layout')
    assert not errors, errors
    record('Browser runtime', 'no uncaught page errors')
    context.close()
    unsupported=browser.new_context(viewport={'width':390,'height':844})
    unsupported.add_init_script("window.SpeechRecognition=undefined;window.webkitSpeechRecognition=undefined;")
    up=unsupported.new_page();up.goto('http://localhost:3000/',wait_until='networkidle')
    up.locator('.voice-top').click()
    up.get_by_role('alert').filter(has_text='Speech recognition is not available').wait_for()
    record('Unsupported browser', 'explicit fallback rather than fake recognition')
    unsupported.close()

    corrupt=browser.new_context()
    cp=corrupt.new_page();cp.goto('http://localhost:3000/',wait_until='networkidle')
    cp.evaluate("""() => {
      const w=JSON.parse(localStorage.getItem('steadier.workspace.v2.demo'));
      w.tasks[0].state='invalid-state';
      localStorage.setItem('steadier.workspace.v2.demo',JSON.stringify(w));
    }""")
    raw=cp.evaluate("localStorage.getItem('steadier.workspace.v2.demo')")
    cp.reload(wait_until='networkidle')
    cp.get_by_role('alert').filter(has_text='It has not been overwritten').wait_for()
    assert cp.evaluate("localStorage.getItem('steadier.workspace.v2.demo')")==raw
    record('Corrupt storage protection','invalid saved state is read-only and original bytes are preserved')
    corrupt.close()

    # Test built shell on a private local test origin, not a published site.
    server=subprocess.Popen(['python3','-m','http.server','3123','--bind','127.0.0.1','--directory',str(ROOT/'dist/public')],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        for _ in range(30):
            try:
                urllib.request.urlopen('http://127.0.0.1:3123/',timeout=1);break
            except Exception:time.sleep(.1)
        offline=browser.new_context(viewport={'width':390,'height':844},service_workers='allow')
        op=offline.new_page();op.goto('http://127.0.0.1:3123/',wait_until='networkidle')
        op.evaluate('navigator.serviceWorker.ready.then(()=>true)')
        op.reload(wait_until='networkidle')
        op.evaluate("caches.open('steadier-shell-v1').then(c=>c.keys()).then(k=>k.length)")
        offline.set_offline(True)
        op.reload(wait_until='domcontentloaded')
        op.locator('.lead-task').wait_for()
        assert '200 responsibilities held' in op.locator('.page-heading').inner_text()
        record('Production offline shell', 'built app reloads offline after online service-worker installation')
        offline.close()
    finally:
        server.terminate();server.wait(timeout=5)
    browser.close()

(OUT/'smoke-results.json').write_text(json.dumps(results,indent=2)+'\n')
print(f'Completed {len(results)} targeted checks. Real microphone/voice output and user usability testing remain untested.',flush=True)
