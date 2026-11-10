import { afterEach, describe, expect, it, vi } from "vitest";
import { copyBackupText, downloadBackup } from "./backupTransport";

type MockAnchor = {
  href: string;
  download: string;
  hidden: boolean;
  style: { display?: string };
  click: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
};

type MockTextarea = {
  value: string;
  readOnly: boolean;
  className: string;
  style: { position?: string; opacity?: string };
  setAttribute: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  setSelectionRange: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
};

function makeAnchor(click: () => void = () => undefined): MockAnchor {
  return {
    href: "",
    download: "",
    hidden: false,
    style: {},
    click: vi.fn(click),
    remove: vi.fn(),
  };
}

function makeTextarea(): MockTextarea {
  return {
    value: "",
    readOnly: false,
    className: "",
    style: {},
    setAttribute: vi.fn(),
    focus: vi.fn(),
    select: vi.fn(),
    setSelectionRange: vi.fn(),
    remove: vi.fn(),
  };
}

function installUrlStubs() {
  const createObjectURL = vi.fn(() => "blob:private-backup");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  return { createObjectURL, revokeObjectURL };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("copyBackupText", () => {
  it("uses a selected temporary readonly textarea when clipboard permission is denied", async () => {
    const textarea = makeTextarea();
    const previousFocus = { focus: vi.fn() };
    const appendChild = vi.fn();
    const execCommand = vi.fn(() => true);
    const writeText = vi.fn().mockRejectedValue(new Error("permission denied"));
    const readText = vi.fn();

    vi.stubGlobal("navigator", { clipboard: { writeText, readText } });
    vi.stubGlobal("document", {
      activeElement: previousFocus,
      body: { appendChild },
      createElement: vi.fn(() => textarea),
      execCommand,
    });

    await expect(
      copyBackupText("private backup text")
    ).resolves.toBeUndefined();

    expect(writeText).toHaveBeenCalledWith("private backup text");
    expect(readText).not.toHaveBeenCalled();
    expect(appendChild).toHaveBeenCalledWith(textarea);
    expect(textarea.readOnly).toBe(true);
    expect(textarea.setAttribute).toHaveBeenCalledWith("readonly", "");
    expect(textarea.className).toBe("rr-block rr-mask");
    expect(textarea.setAttribute).toHaveBeenCalledWith("data-private", "true");
    expect(textarea.setAttribute).toHaveBeenCalledWith(
      "data-hj-suppress",
      "true"
    );
    expect(textarea.setAttribute).toHaveBeenCalledWith("data-ms-mask", "true");
    expect(textarea.focus).toHaveBeenCalledOnce();
    expect(textarea.select).toHaveBeenCalledOnce();
    expect(textarea.setSelectionRange).toHaveBeenCalledWith(
      0,
      "private backup text".length
    );
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(textarea.remove).toHaveBeenCalledOnce();
    expect(previousFocus.focus).toHaveBeenCalledOnce();
  });

  it("returns only the fixed generic error when both clipboard copy paths fail and still cleans up", async () => {
    const textarea = makeTextarea();
    const previousFocus = { focus: vi.fn() };
    const writeText = vi
      .fn()
      .mockRejectedValue(new Error("denied: private data"));

    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("document", {
      activeElement: previousFocus,
      body: { appendChild: vi.fn() },
      createElement: vi.fn(() => textarea),
      execCommand: vi.fn(() => false),
    });

    await expect(copyBackupText("private backup text")).rejects.toThrow(
      "Copy is unavailable in this browser."
    );
    expect(textarea.remove).toHaveBeenCalledOnce();
    expect(previousFocus.focus).toHaveBeenCalledOnce();
  });

  it("uses a successful browser clipboard write without constructing a DOM fallback", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const createElement = vi.fn();

    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("document", { createElement });

    await expect(
      copyBackupText("private backup text")
    ).resolves.toBeUndefined();

    expect(writeText).toHaveBeenCalledWith("private backup text");
    expect(createElement).not.toHaveBeenCalled();
  });

  it("never reads clipboard data or writes browser records", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const readText = vi.fn();
    const storage = {
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    };
    const fetch = vi.fn();

    vi.stubGlobal("navigator", { clipboard: { writeText, readText } });
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("sessionStorage", storage);
    vi.stubGlobal("fetch", fetch);

    await copyBackupText("private backup text");

    expect(readText).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(storage.clear).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("downloadBackup", () => {
  it("clicks an attached hidden anchor and retains the object URL for sixty seconds", () => {
    vi.useFakeTimers();
    const anchor = makeAnchor();
    const appendChild = vi.fn();
    const { createObjectURL, revokeObjectURL } = installUrlStubs();

    vi.stubGlobal("document", {
      body: { appendChild },
      createElement: vi.fn(() => anchor),
    });

    downloadBackup(
      "private backup text",
      "steadier-backup.json",
      "application/custom"
    );

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(anchor.href).toBe("blob:private-backup");
    expect(anchor.download).toBe("steadier-backup.json");
    expect(anchor.hidden).toBe(true);
    expect(anchor.style.display).toBe("none");
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(59_999);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:private-backup");
  });

  it("detaches the anchor and immediately revokes the URL when clicking throws", () => {
    vi.useFakeTimers();
    const clickFailure = new Error("browser blocked download");
    const anchor = makeAnchor(() => {
      throw clickFailure;
    });
    const { revokeObjectURL } = installUrlStubs();

    vi.stubGlobal("document", {
      body: { appendChild: vi.fn() },
      createElement: vi.fn(() => anchor),
    });

    expect(() =>
      downloadBackup("private backup text", "steadier-backup.json")
    ).toThrow(clickFailure);
    expect(anchor.remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:private-backup");
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledOnce();
  });
});
