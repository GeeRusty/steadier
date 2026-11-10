#!/usr/bin/env python3
"""Screenshot every Steadier screen at phone size (sample workspace, local browser only)."""
import re, sys
from playwright.sync_api import sync_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else "/home/ubuntu/screens/before"
SCREENS = [
    ("map", "Compass map"), ("imperatives", "Imperatives"),
    ("weekly", "Weekly Reality Review"), ("calendar", "Calendar"),
    ("near", "Near me"), ("time", "Time & plans"), ("all", "All work"),
    ("review", "Review"), ("waiting", "Waiting & blocked"),
    ("areas", "Life areas"), ("projects", "Projects & outcomes"),
    ("matrix", "My life matrix"), ("progress", "Completed steps"),
    ("settings", "Backups & trial"), ("cloud", "Server & Compass"),
    ("sheet", "Server sheet"),
]
import os
os.makedirs(OUT, exist_ok=True)
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path="/usr/bin/chromium", args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("dialog", lambda d: d.accept())
    page.goto("http://localhost:3000/", wait_until="networkidle")
    switch = page.locator(".workspace-switch")
    if "Sample" not in switch.inner_text():
        if not switch.is_visible():
            page.get_by_role("button", name="Open navigation").first.click()
        switch.click()
        page.wait_for_timeout(600)
    page.wait_for_selector("#today-now")
    for key, label in SCREENS:
        page.evaluate("window.scrollTo(0,0)")
        nav = page.get_by_role("navigation", name="Main navigation")
        if not nav.is_visible():
            page.get_by_role("button", name="Open navigation").first.click()
        nav.locator(".nav-item").filter(has=page.locator("span", has_text=re.compile("^" + re.escape(label) + "$"))).first.click()
        page.wait_for_timeout(700)
        if page.get_by_role("button", name="Close navigation").count() and page.get_by_role("button", name="Close navigation").first.is_visible():
            page.get_by_role("button", name="Close navigation").first.click()
        d = page.evaluate("({w:innerWidth,s:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight})")
        flag = " SIDEWAYS" if d["s"] > d["w"] + 1 else ""
        print(f"{key}: height {d['h']}px{flag}")
        page.screenshot(path=f"{OUT}/{key}.png", full_page=True)
    print("errors:", errors)
    b.close()
