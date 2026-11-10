#!/usr/bin/env python3
"""Today redesign smoke test at phone size. Sample workspace in a fresh local browser only."""
from playwright.sync_api import sync_playwright

MOCK_VOICE = r"""
window.SpeechSynthesisUtterance = class { constructor(t){this.text=t;} };
Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{
 getVoices(){return [{lang:'en-AU'}];},
 speak(u){window.__lastRead=u.text;u.onstart?.();this.u=u;},
 cancel(){this.u?.onend?.();this.u=null;}
}});
"""


def no_overflow(page, name):
    d = page.evaluate("({w:innerWidth,s:document.documentElement.scrollWidth})")
    assert d["s"] <= d["w"] + 1, (name, d)
    print(f"{name}: no sideways scroll at {d['w']}px")


with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path="/usr/bin/chromium", args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    ctx.add_init_script(MOCK_VOICE)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("dialog", lambda d: d.accept())
    page.goto("http://localhost:3000/", wait_until="networkidle")
    # Use the built-in sample workspace (local, safe to explore).
    switch = page.locator(".workspace-switch")
    if "Sample" not in switch.inner_text():
        if not switch.is_visible():
            page.get_by_role("button", name="Open navigation").first.click()
        switch.click()
        page.wait_for_timeout(600)
        if page.get_by_role("button", name="Close navigation").count():
            page.get_by_role("button", name="Close navigation").first.click()
    page.wait_for_selector("#today-now")
    print("Today shows the Now card")
    assert page.get_by_role("tab", name="Today").get_attribute("aria-selected") == "true"
    assert page.locator(".intention-bar").count() == 1
    assert page.locator(".state-mark").count() > 0, "state marks missing"
    no_overflow(page, "Today")
    page.screenshot(path="/home/ubuntu/today-phone-1.png")
    # Intention by typing.
    page.locator(".intention-bar").get_by_role("button").first.click()
    dlg = page.get_by_role("dialog")
    dlg.wait_for()
    print("intention editor opened")
    page.keyboard.press("Escape")
    dlg.wait_for(state="hidden")
    # Re-anchor reads aloud.
    if page.get_by_role("button", name="Re-anchor").count():
        page.get_by_role("button", name="Re-anchor").click()
        page.get_by_role("dialog").wait_for()
        page.wait_for_timeout(300)
        said = page.evaluate("window.__lastRead || ''")
        print("re-anchor read aloud:", said[:80])
        page.keyboard.press("Escape")
        page.get_by_role("dialog").wait_for(state="hidden")
    # Scroll: the intention bar folds and stays at the top.
    page.mouse.wheel(0, 1200)
    page.wait_for_timeout(400)
    page.screenshot(path="/home/ubuntu/today-phone-2.png")
    # Overview.
    page.evaluate("window.scrollTo(0,0)")
    page.get_by_role("tab", name="Overview").click()
    page.get_by_role("heading", name="Life areas").wait_for()
    page.get_by_role("heading", name="Held").wait_for()
    assert page.get_by_text("On hold").count() == 0
    no_overflow(page, "Overview")
    page.screenshot(path="/home/ubuntu/today-phone-3.png", full_page=True)
    # All work uses the same counts and the Held filter.
    page.get_by_role("button", name="See all held").click()
    page.wait_for_timeout(400)
    rows = page.locator(".work-row").count()
    held = page.locator(".work-row.kind-held").count()
    assert rows == held, (rows, held)
    print(f"All work Held filter: {held} held rows")
    body = page.locator("main").inner_text()
    assert " ready" not in body.lower().replace("already", ""), "word 'ready' still shown"
    assert not errors, errors
    print("no page errors")
    b.close()
