import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { emptyWorkspace } from "../../../../server/steadier/validation";
import type { VoiceControls } from "../../hooks/useVoice";
import { reviewCardText, UNPLACED_INTRO, UNPLACED_REVIEW_INTRO, UnplacedPanel } from "./CompassPanels";
import PagePurposeNote from "./PagePurposeNote";
import WeeklyReviewFlow from "./WeeklyReviewFlow";

const voice = {
  supported: false,
  speechSupported: false,
  listening: false,
  speaking: false,
  transcript: "",
  error: "",
  read: () => {},
  start: () => {},
  stop: () => {},
  clear: () => {},
  abort: () => {},
  stopSpeaking: () => {},
} as unknown as VoiceControls;

describe("Review due card", () => {
  it("allows 30–40 minutes for a first review, in the current step order", () => {
    const text = reviewCardText(emptyWorkspace(), "2026-11-13");
    expect(text).toContain("about 30–40 minutes");
    expect(text).toContain("Unplaced, Front of Mind and Link check first, then Floor Check (money, action, capacity), Imperatives and the map");
  });

  it("allows 15–25 minutes once a review has been done", () => {
    const w = emptyWorkspace();
    w.trial = { ...w.trial, lastReviewAt: "2026-11-06T09:00:00" };
    const text = reviewCardText(w, "2026-11-13");
    expect(text).toContain("Last done 2026-11-06 (7 days ago). About 15–25 minutes.");
    expect(text).not.toContain("30–40");
  });
});

describe("Explanations behind the info icon", () => {
  it("the Unplaced intro can move off the panel", () => {
    const props = { workspace: emptyWorkspace(), onMutate: () => true, onOpenTask: () => {}, readOnly: false };
    expect(renderToStaticMarkup(<UnplacedPanel {...props} />)).toContain(UNPLACED_INTRO);
    expect(renderToStaticMarkup(<UnplacedPanel {...props} introInInfo />)).not.toContain(UNPLACED_INTRO);
  });

  it("the info note carries relocated lines word for word", () => {
    const html = renderToStaticMarkup(<PagePurposeNote view="review" extra={[UNPLACED_INTRO]} />);
    expect(html).toContain("What this page is for:");
    expect(html).toContain(UNPLACED_INTRO);
    const weekly = renderToStaticMarkup(<PagePurposeNote view="weekly" extra={[UNPLACED_REVIEW_INTRO]} />);
    expect(weekly).toContain(UNPLACED_REVIEW_INTRO);
    expect(weekly).not.toContain("What this page is for:");
  });
});

describe("Weekly Review", () => {
  const html = renderToStaticMarkup(
    <WeeklyReviewFlow workspace={emptyWorkspace()} onMutate={() => true} onOpenTask={() => {}} onDone={() => {}} voice={voice} readOnly={false} />
  );

  it("shows one step line and a thin bar instead of ten tabs", () => {
    expect(html).toContain("Step 1 of 10");
    expect(html).toContain('role="progressbar"');
    expect(html).not.toContain("review-steps");
    expect(html).toContain("Begin");
  });

  it("Start card names the steps in their current order and keeps the closing line", () => {
    expect(html).toContain("Unplaced, Front of Mind and Link check first, then Floor Check (money, action, capacity), Imperatives and the map.");
    expect(html).toContain("You decide everything; Steadier only writes it down.");
    expect(html).toContain("This is your first Weekly Reality Review.");
  });

  it("has no Read aloud on the page (it lives in the ⋮ menu)", () => {
    expect(html).not.toMatch(/Read (\w+ )?aloud/);
  });
});
