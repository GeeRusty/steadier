#!/usr/bin/env python3
"""Pillar strip smoke test at phone size. Local, unsigned browser data only."""
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


def add_pillar(page, title):
    form = page.locator("section.imperative-add")
    form.get_by_role("radio", name="Pillar").click()
    form.locator("input").first.fill(title)
    form.get_by_role("button", name="Add", exact=False).last.click()
    page.get_by_role("button", name=f"Open Pillar {title}").wait_for()


with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path="/usr/bin/chromium", args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    ctx.add_init_script(MOCK_VOICE)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("dialog", lambda d: d.accept())
    page.goto("http://localhost:3000/#map", wait_until="networkidle")
    page.locator(".compass-map").wait_for()

    # Empty map: eight free slots, caption nudges, nothing on Today yet.
    strip = page.locator(".compass-map .pillar-strip")
    assert strip.locator(".pillar-slot").count() == 8
    assert strip.locator(".pillar-slot.empty").count() == 8
    assert "No Pillars yet" in strip.locator(".pillar-caption").inner_text()
    print("Map, no Pillars: 8 free slots + gentle caption")
    no_overflow(page, "Map (empty strip)")

    # Tapping a free slot jumps to the Pillar form.
    strip.locator(".pillar-slot.empty").first.click()
    page.wait_for_timeout(700)
    focused = page.evaluate("document.activeElement && document.activeElement.tagName")
    assert focused == "INPUT", focused
    assert page.get_by_role("radio", name="Pillar").get_attribute("aria-checked") == "true"
    print("Free slot -> Pillar form focused with Pillar level chosen")

    # Add three Pillars; they fill slots 1-3 in order, new ones are amber.
    for t in ["Smoke Family", "Smoke Health", "Smoke Work"]:
        add_pillar(page, t)
    slots = strip.locator(".pillar-slot")
    assert strip.locator(".pillar-slot.empty").count() == 5
    assert strip.locator(".pillar-slot.amber").count() == 3
    first = slots.nth(0)
    assert "Smoke Family" in first.get_attribute("aria-label")
    assert "no Value Goal yet" in first.get_attribute("aria-label")
    print("3 Pillars added: slots 1-3 amber (a gap, not a failure), 5 free")

    # Read aloud speaks every Pillar.
    strip.get_by_role("button", name="Read Pillars").click()
    spoken = page.evaluate("window.__lastRead")
    assert "Smoke Family: needs a look" in spoken and "5 free slots" in spoken, spoken
    print("Read aloud:", spoken[:90], "...")

    # Visual check only: show how green and red look beside amber.
    page.evaluate(
        """()=>{const s=document.querySelectorAll('.compass-map .pillar-slot');
        s[0].className='pillar-slot green';s[0].querySelector('.pillar-glyph').textContent='\u2713';
        s[2].className='pillar-slot red';s[2].querySelector('.pillar-glyph').textContent='!';}"""
    )
    strip.scroll_into_view_if_needed()
    page.screenshot(path="/home/ubuntu/strip-map.png", clip={"x": 0, "y": 0, "width": 390, "height": 520})
    page.reload(wait_until="networkidle")
    page.locator(".compass-map").wait_for()

    # Tapping a Pillar opens its page.
    page.locator(".compass-map .pillar-slot", has_text="Smoke Health").click()
    page.locator(".map-page").wait_for()
    assert page.locator(".map-page-title").inner_text() == "Smoke Health"
    print("Tap a Pillar -> its page:", page.evaluate("location.hash"))
    no_overflow(page, "Pillar page")

    # Today: slim strip under the intention bar; the next free slot is "Add".
    page.goto("http://localhost:3000/", wait_until="networkidle")
    page.wait_for_selector(".pillar-strip.is-compact")
    today = page.locator(".pillar-strip.is-compact")
    assert today.locator(".pillar-slot:not(.empty)").count() == 3
    assert today.locator(".pillar-slot.empty").count() == 1
    assert today.locator(".pillar-slot.empty").inner_text().strip() == "Add"
    no_overflow(page, "Today (strip)")
    page.screenshot(path="/home/ubuntu/strip-today.png", clip={"x": 0, "y": 0, "width": 390, "height": 560})
    # Today's free slot jumps to the map's Pillar form.
    today.locator(".pillar-slot.empty").click()
    page.locator(".compass-map").wait_for()
    page.wait_for_timeout(700)
    assert page.evaluate("document.activeElement.tagName") == "INPUT"
    print("Today 'Add' -> Map, Pillar form focused")
    # Later visits to the map do not jump again.
    page.goto("http://localhost:3000/", wait_until="networkidle")
    page.goto("http://localhost:3000/#map")
    page.locator(".compass-map").wait_for()
    page.wait_for_timeout(600)
    assert page.evaluate("document.activeElement.tagName") != "INPUT"
    print("Reopening the map does not steal focus")
    # Tap a Pillar from Today, then Back returns to Today.
    page.goto("http://localhost:3000/", wait_until="networkidle")
    page.locator(".pillar-strip.is-compact .pillar-slot", has_text="Smoke Work").click()
    page.locator(".map-page").wait_for()
    page.go_back()
    page.wait_for_selector(".pillar-strip.is-compact")
    print("Today -> Pillar page -> Back returns to Today")

    # Eight and more: ninth is reachable, nothing hidden.
    page.goto("http://localhost:3000/#map", wait_until="networkidle")
    page.locator(".compass-map").wait_for()
    for i in range(4, 10):
        add_pillar(page, f"Smoke P{i}")
    strip = page.locator(".compass-map .pillar-strip")
    assert strip.locator(".pillar-slot:not(.empty)").count() == 8
    assert "+1 more Pillar" in strip.inner_text()
    print("9 Pillars: 8 in the row, '+1 more Pillar on the map' link shown")
    no_overflow(page, "Map (full strip)")
    print("no page errors" if not errors else errors)
    assert not errors
    b.close()
