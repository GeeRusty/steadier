import { describe, expect, it } from "vitest";
import {
  automaticCalendarChimeBoundaries,
  automaticCalendarChimeDue,
  automaticCheckInSpeech,
  automaticTaskTitleSpeech,
  crossedFocusChimeBoundary,
  crossedFocusChimeBoundaries,
  focusChimeInterval,
  spokenTimeToGo,
  isBookedClockTimedCalendarSchedule,
} from "./focusChimes";
import { emptyRepeat, emptyTaskSchedule } from "./time";

describe("focus task chimes", () => {
  it("recognizes a booked recurring timer when only the series stores its clock time", () => {
    const recurring = {
      ...emptyTaskSchedule(),
      date: null,
      time: null,
      fixed: true,
      repeat: emptyRepeat("weekly"),
      repeatAnchorDate: "2026-11-02",
      repeatOccurrenceDate: "2026-11-02",
      repeatTime: "09:00",
    };
    const untimed = {
      ...emptyTaskSchedule(),
      date: "2026-11-02",
      time: null,
      fixed: true,
    };
    const flexible = {
      ...recurring,
      flexibleWindow: { startDate: "2026-11-02", endDate: "2026-11-03" },
    };

    expect(isBookedClockTimedCalendarSchedule(recurring)).toBe(true);
    expect(isBookedClockTimedCalendarSchedule(untimed)).toBe(false);
    expect(isBookedClockTimedCalendarSchedule(flexible)).toBe(false);
  });

  it("uses quarter-hour chimes below an hour and hourly chimes at or above an hour", () => {
    expect(focusChimeInterval(59 * 60)).toBe(15 * 60);
    expect(focusChimeInterval(60 * 60)).toBe(15 * 60);
    expect(focusChimeInterval(61 * 60)).toBe(30 * 60);
    expect(focusChimeInterval(2 * 60 * 60)).toBe(30 * 60);
    expect(focusChimeInterval(0)).toBeNull();
  });

  it("fires only when a running task timer crosses an interval boundary", () => {
    expect(crossedFocusChimeBoundary(45 * 60, 30 * 60 + 1, 30 * 60 - 1)).toBe(true);
    expect(crossedFocusChimeBoundary(2 * 60 * 60, 60 * 60 + 1, 60 * 60 - 1)).toBe(true);
    expect(crossedFocusChimeBoundary(45 * 60, 20 * 60, 19 * 60)).toBe(false);
    expect(crossedFocusChimeBoundary(30 * 60, 15 * 60 + 1, 15 * 60 - 1)).toBe(true);
  });

  it("does not chime for a stopped, reset, invalid or just-finished interval", () => {
    expect(crossedFocusChimeBoundary(30 * 60, 10 * 60, 0)).toBe(false);
    expect(crossedFocusChimeBoundary(30 * 60, 10 * 60, 11 * 60)).toBe(false);
    expect(crossedFocusChimeBoundary(30 * 60, 31 * 60, 10 * 60)).toBe(false);
    expect(crossedFocusChimeBoundary(Number.NaN, 10 * 60, 9 * 60)).toBe(false);
  });

  it("replays every crossed interval after a delayed tick but excludes the end boundary", () => {
    expect(crossedFocusChimeBoundaries(45 * 60, 45 * 60, 0)).toEqual([
      15 * 60,
      30 * 60,
    ]);
    expect(crossedFocusChimeBoundaries(2 * 60 * 60, 2 * 60 * 60, 0)).toEqual([
      30 * 60,
      60 * 60,
      90 * 60,
    ]);
    expect(
      automaticCalendarChimeBoundaries(
        true,
        true,
        45 * 60,
        45 * 60,
        0
      )
    ).toEqual([15 * 60, 30 * 60]);
    expect(
      automaticCalendarChimeBoundaries(
        true,
        false,
        45 * 60,
        45 * 60,
        0
      )
    ).toEqual([15 * 60, 30 * 60]);
    expect(
      automaticCalendarChimeBoundaries(true, false, 45 * 60, 30 * 60, 30 * 60)
    ).toEqual([]);
    expect(
      automaticCalendarChimeBoundaries(
        false,
        true,
        45 * 60,
        45 * 60,
        0
      )
    ).toEqual([]);
  });

  it("automatically speaks the title for every supported timed Calendar cadence", () => {
    expect(
      automaticCalendarChimeDue(true, true, 45 * 60, 30 * 60 + 1, 30 * 60 - 1)
    ).toBe(true);
    expect(
      automaticCalendarChimeDue(true, true, 2 * 60 * 60, 60 * 60 + 1, 60 * 60 - 1)
    ).toBe(true);
    expect(
      automaticCalendarChimeDue(false, true, 45 * 60, 30 * 60 + 1, 30 * 60 - 1)
    ).toBe(false);
    expect(
      automaticCalendarChimeDue(true, false, 45 * 60, 30 * 60 + 1, 30 * 60 - 1)
    ).toBe(false);
    expect(automaticTaskTitleSpeech("  Skeeti Paint cleaning  ", true)).toBe(
      "Skeeti Paint cleaning"
    );
    expect(automaticTaskTitleSpeech("Skeeti Paint cleaning", false)).toBeNull();
    expect(automaticTaskTitleSpeech("  ", true)).toBeNull();
    expect(automaticCheckInSpeech("Skeeti Paint cleaning", 3, true)).toBe(
      "Skeeti Paint cleaning. Skeeti Paint cleaning. Skeeti Paint cleaning"
    );
    expect(automaticCheckInSpeech("Skeeti Paint cleaning", 0, true)).toBeNull();
  });

  it("says the task and the time left, once, at each check-in", () => {
    expect(automaticCheckInSpeech("Uber shift", 1, true, 45 * 60 - 1)).toBe(
      "Uber shift. 45 minutes to go."
    );
    expect(automaticCheckInSpeech("Uber shift", 3, true, 90 * 60)).toBe(
      "Uber shift. 1 hour 30 minutes to go."
    );
    expect(automaticCheckInSpeech("Uber shift", 1, true, 120 * 60)).toBe(
      "Uber shift. 2 hours to go."
    );
    expect(automaticCheckInSpeech("Uber shift", 1, false, 45 * 60)).toBeNull();
    expect(spokenTimeToGo(60)).toBe("1 minute to go");
    expect(spokenTimeToGo(61 * 60)).toBe("1 hour 1 minute to go");
    expect(spokenTimeToGo(10)).toBeNull();
  });
});
