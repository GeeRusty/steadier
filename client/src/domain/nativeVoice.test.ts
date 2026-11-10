import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasNativeVoiceDraftHandoff,
  isNativeVoiceDraftEvent,
} from "./nativeVoice";

afterEach(() => vi.unstubAllGlobals());

describe("native voice draft handoff detection", () => {
  it("does not claim a native bridge when it is absent or not HTTPS", () => {
    vi.stubGlobal("window", undefined);
    expect(hasNativeVoiceDraftHandoff()).toBe(false);

    vi.stubGlobal("window", {
      location: { protocol: "http:" },
      ReactNativeWebView: { postMessage: () => {} },
    });
    expect(hasNativeVoiceDraftHandoff()).toBe(false);
  });

  it("recognizes only synthetic events when a secure native bridge is present", () => {
    vi.stubGlobal("window", {
      location: { protocol: "https:" },
      ReactNativeWebView: { postMessage: () => {} },
    });

    expect(hasNativeVoiceDraftHandoff()).toBe(true);
    expect(isNativeVoiceDraftEvent(new Event("input"))).toBe(true);
    expect(isNativeVoiceDraftEvent({ isTrusted: true } as Event)).toBe(false);
  });
});
