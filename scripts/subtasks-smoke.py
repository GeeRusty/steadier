#!/usr/bin/env python3
"""Subtasks smoke test at phone size. Local, unsigned browser data only."""
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
    dialogs = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    def on_dialog(d):
        dialogs.append(d.message)
        d.accept()

    page.on("dialog", on_dialog)
    page.goto("http://localhost:3000/", wait_until="networkidle")

    # Capture a parent task (title only).
    page.get_by_role("button", name="Capture").first.click()
    dialog = page.get_by_role("dialog")
    dialog.get_by_role("textbox").first.fill("Smoke move house")
    dialog.get_by_role("button", name="Save responsibility").click()
    dialog.wait_for(state="hidden")
    print("captured parent")

    # Open it from All work.
    page.keyboard.press("Escape")
    nav = page.get_by_role("navigation", name="Main navigation")
    if not nav.is_visible():
        page.get_by_role("button", name="Open navigation").first.click()
    nav.get_by_role("button", name="All work").click()
    page.locator(".work-row-main", has_text="Smoke move house").click()
    editor = page.get_by_role("dialog")
    editor.locator(".subtasks-section > summary").click()

    for title in ["Smoke pack boxes", "Smoke book truck"]:
        editor.get_by_role("textbox", name="New subtask").fill(title)
        editor.get_by_role("textbox", name="New subtask").press("Enter")
        editor.locator(".subtask-row", has_text=title).wait_for()
    assert "0/2" in editor.locator(".subtasks-section > summary").inner_text()
    print("added 2 subtasks from the parent's editor: 0/2")

    editor.get_by_role("checkbox", name="Complete subtask Smoke pack boxes").check()
    editor.locator(".subtasks-section > summary", has_text="1/2").wait_for()
    print("ticked one subtask, editor stayed open: 1/2")
    no_overflow(page, "Parent editor")
    page.screenshot(path="/home/ubuntu/subtasks-editor-phone.png", full_page=False)

    # Open a subtask; its breadcrumb leads back to the parent.
    editor.locator(".subtask-open", has_text="Smoke book truck").click()
    crumb = page.locator(".subtask-crumb")
    crumb.wait_for()
    assert "Smoke move house" in crumb.inner_text()
    page.get_by_role("textbox", name="New subtask").fill("Smoke call movers")
    page.get_by_role("textbox", name="New subtask").press("Enter")
    page.locator(".subtask-row", has_text="Smoke call movers").wait_for()
    page.get_by_role("button", name="Read subtasks aloud").click()
    spoken = page.evaluate("window.__lastRead")
    assert "Subtask of Smoke move house" in spoken, spoken
    print("subtask page: breadcrumb to parent, added a level-2 subtask, read aloud:", spoken)
    page.keyboard.press("Escape")

    # The list nests subtasks and collapses.
    rows = page.locator(".work-row")
    truck = page.locator(".work-row", has=page.locator(".work-row-main", has_text="Smoke book truck"))
    movers = page.locator(".work-row", has=page.locator(".work-row-main", has_text="Smoke call movers"))
    assert "is-subtask" in truck.get_attribute("class")
    assert "is-subtask" in movers.get_attribute("class")
    page.get_by_role("button", name="Hide subtasks of Smoke move house").click()
    assert movers.count() == 0 and truck.count() == 0
    page.get_by_role("button", name="Show subtasks of Smoke move house").click()
    truck.wait_for()
    print("list: subtasks nested under parent; collapse and expand work")
    no_overflow(page, "All work list")
    page.screenshot(path="/home/ubuntu/subtasks-list-phone.png", full_page=False)

    # Finishing the parent asks about its open subtasks.
    page.get_by_role("button", name="Complete Smoke move house").click()
    page.get_by_text("Completed with 2 subtasks").wait_for()
    assert any("open subtask" in m for m in dialogs), dialogs
    assert page.locator(".work-row-main", has_text="Smoke").count() == 0
    print("finishing the parent asked first, then finished its 2 open subtasks too")

    assert not errors, errors
    print("no page errors")
    b.close()
