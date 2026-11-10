#!/usr/bin/env python3
"""Location reminders smoke test at phone size, with a simulated GPS position.
Local, unsigned browser data only (nothing reaches the shared server)."""
from playwright.sync_api import sync_playwright

MOCK_VOICE = r"""
window.__reads = [];
window.SpeechSynthesisUtterance = class { constructor(t){this.text=t;} };
Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{
 getVoices(){return [{lang:'en-AU'}];},
 speak(u){window.__reads.push(u.text);u.onstart?.();this.u=u;},
 cancel(){this.u?.onend?.();this.u=null;}
}});
"""
CBD = {"latitude": -34.9285, "longitude": 138.6007, "accuracy": 20}
BUNNINGS = {"latitude": -34.93314, "longitude": 138.57543, "accuracy": 20}


def no_overflow(page, name):
    d = page.evaluate("({w:innerWidth,s:document.documentElement.scrollWidth})")
    assert d["s"] <= d["w"] + 1, (name, d)
    print(f"{name}: no sideways scroll at {d['w']}px")


with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path="/usr/bin/chromium", args=["--no-sandbox"])
    ctx = b.new_context(
        viewport={"width": 390, "height": 844},
        is_mobile=True,
        has_touch=True,
        geolocation=CBD,
        permissions=["geolocation"],
    )
    ctx.add_init_script(MOCK_VOICE)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("dialog", lambda d: d.accept())
    page.goto("http://localhost:3000/", wait_until="networkidle")

    def go(name):
        page.keyboard.press("Escape")
        nav = page.get_by_role("navigation", name="Main navigation")
        if not nav.is_visible():
            page.get_by_role("button", name="Open navigation").first.click()
        nav.get_by_role("button", name=name).click()

    # Capture a task (title only).
    page.get_by_role("button", name="Capture").first.click()
    dialog = page.get_by_role("dialog")
    dialog.get_by_role("textbox").first.fill("Smoke buy screws")
    dialog.get_by_role("button", name="Save responsibility").click()
    dialog.wait_for(state="hidden")
    print("captured task")

    # Add a place by pasting a map link.
    go("Near me")
    form = page.get_by_role("form", name="Add a place")
    form.get_by_label("Name").fill("Smoke Bunnings")
    form.get_by_label("Or paste a Google Maps link or coordinates").fill(
        "https://www.google.com/maps/place/Bunnings/@-34.93314,138.57543,17z"
    )
    form.get_by_text("Location chosen").wait_for()
    form.get_by_role("button", name="Save place").click()
    page.locator(".near-place-list li", has_text="Smoke Bunnings").wait_for()
    print("saved a place from a pasted Google Maps link")

    # Give the task that place in its editor.
    go("All work")
    page.locator(".work-row-main", has_text="Smoke buy screws").click()
    editor = page.get_by_role("dialog")
    editor.get_by_label("Place", exact=True).select_option(label="Smoke Bunnings")
    editor.get_by_role("button", name="Save").first.click()
    editor.wait_for(state="hidden")
    page.locator(".place-chip", has_text="at Smoke Bunnings").first.wait_for()
    print("task card shows: at Smoke Bunnings")

    # Near me: distance shown from the CBD, I'm at… puts it first.
    go("Near me")
    group = page.locator(".near-group", has_text="Smoke Bunnings")
    page.get_by_role("button", name="Check where I am").click()
    group.get_by_text("km away").wait_for()
    print("Near me shows:", group.locator("header").inner_text().replace("\n", " "))
    page.get_by_role("group", name="I'm at…").get_by_role("button", name="Smoke Bunnings").click()
    group.get_by_text("You're here").wait_for()
    print("I'm at… marks it 'You're here'")
    page.locator(".near-view").get_by_role("button", name="Read aloud").first.click()
    print("read aloud:", page.evaluate("window.__reads.at(-1)"))
    page.get_by_role("group", name="I'm at…").get_by_role("button", name="Smoke Bunnings").click()

    # Switch on arrival reminders, then "drive" to Bunnings.
    page.get_by_role("switch", name="Remind me when I arrive").click()
    page.get_by_text("On. Watching for your places").wait_for(timeout=15000)
    print("switch on: watching")
    ctx.set_geolocation(BUNNINGS)
    page.get_by_text("You're at Smoke Bunnings").first.wait_for(timeout=20000)
    spoken = page.evaluate("window.__reads.at(-1)")
    assert "Smoke buy screws" in spoken, spoken
    print("arrival notice shown; spoken:", spoken)
    no_overflow(page, "Near me")
    page.screenshot(path="/home/ubuntu/near-me-phone.png", full_page=False)

    # Moving around inside does not ring again.
    reads = page.evaluate("window.__reads.length")
    ctx.set_geolocation({**BUNNINGS, "latitude": BUNNINGS["latitude"] + 0.0003})
    page.wait_for_timeout(3000)
    assert page.evaluate("window.__reads.length") == reads
    print("no second ring while still there")

    # Places survive a reload; switch stays on.
    page.reload(wait_until="networkidle")
    go("Near me")
    page.locator(".near-places > summary").click()
    page.locator(".near-place-list li", has_text="Smoke Bunnings").wait_for()
    assert page.get_by_role("switch", name="Remind me when I arrive").get_attribute("aria-checked") == "true"
    print("after reload: place kept, switch still on")
    page.screenshot(path="/home/ubuntu/near-me-phone-2.png", full_page=True)
    assert not errors, errors
    print("no page errors")
    b.close()
