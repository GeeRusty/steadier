#!/usr/bin/env python3
"""Map level pages smoke test at phone size. Local, unsigned browser data only."""
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
    page.goto("http://localhost:3000/#map", wait_until="networkidle")
    page.locator(".compass-map").wait_for()
    print("open #map: tree shown")

    # Create one Pillar with the existing form.
    form = page.locator("section.imperative-add")
    form.get_by_role("radio", name="Pillar").click()
    form.locator("input").first.fill("Smoke Family")
    form.get_by_role("button", name="Add", exact=False).last.click()
    page.get_by_role("button", name="Open Pillar Smoke Family").wait_for()

    # Open its page from the tree.
    page.get_by_role("button", name="Open Pillar Smoke Family").click()
    page.locator(".map-page").wait_for()
    pillar_hash = page.evaluate("location.hash")
    assert pillar_hash.startswith("#map/"), pillar_hash
    assert page.locator(".map-page-title").inner_text() == "Smoke Family"
    assert page.locator(".map-page-gaps").count() == 1, "empty Pillar gap shown"
    print("Pillar page:", pillar_hash, "with gap alert")
    no_overflow(page, "Pillar page")

    # Add a new Value Goal from the Pillar's page.
    page.get_by_role("textbox", name="New Value Goal title").fill("Smoke Home")
    page.get_by_role("button", name="Add new").click()
    page.get_by_role("status").filter(has_text="Added new Value Goal").wait_for()
    page.locator(".map-row-open", has_text="Smoke Home").click()
    page.locator(".map-page-title", has_text="Smoke Home").wait_for()
    vg_hash = page.evaluate("location.hash")
    assert vg_hash != pillar_hash
    assert page.locator(".map-row-open", has_text="Smoke Family").count() == 1
    print("Value Goal page:", vg_hash, "sits under Smoke Family (confirmed)")

    # New Outcome under it, then read aloud.
    page.get_by_role("textbox", name="New Goal Outcome title").fill("Smoke Lease")
    page.get_by_role("button", name="Add new").click()
    page.locator(".map-row-open", has_text="Smoke Lease").click()
    page.locator(".map-page-title", has_text="Smoke Lease").wait_for()
    assert page.get_by_role("heading", name="Projects serving this").count() == 1
    page.locator("main").get_by_role("button", name="Read aloud").last.click()
    spoken = page.evaluate("window.__lastRead")
    assert "Goal Outcome: Smoke Lease" in spoken and "Smoke Home" in spoken, spoken
    print("Outcome page read aloud:", spoken[:90], "...")
    no_overflow(page, "Outcome page")

    # Phone back button walks back up.
    page.go_back()
    page.locator(".map-page-title", has_text="Smoke Home").wait_for()
    page.go_back()
    page.locator(".map-page-title", has_text="Smoke Family").wait_for()
    page.go_back()
    page.locator(".compass-map").wait_for()
    print("Back button: Outcome -> Value Goal -> Pillar -> map tree")

    # Deep link opens the page directly after a reload.
    page.goto("http://localhost:3000/" + vg_hash, wait_until="networkidle")
    page.locator(".map-page-title", has_text="Smoke Home").wait_for()
    print("Deep link reload opens the Value Goal page")
    page.screenshot(path="/home/ubuntu/map-page-phone.png", full_page=True)

    assert not errors, errors
    print("no page errors")
    b.close()
