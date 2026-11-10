import { useEffect, useRef } from "react";
import type { FocusSession, Task } from "../domain/types";
import {
  automaticCalendarChimeBoundaries,
  automaticCheckInSpeech,
  automaticTaskTitleSpeech,
  isBookedClockTimedCalendarSchedule,
} from "../domain/focusChimes";
import {
  alwaysOnFocusToneSettings,
  playTone,
  readToneSettings,
  unlockTones,
} from "../lib/tones";

type Speaker = { read: (text: string) => void; speechSupported: boolean };

/** Focus blocks shorter than this get no halfway check-in. */
const HALFWAY_MIN_SECONDS = 10 * 60;

/**
 * Automatically chimes and speaks at the interval for a booked, timed
 * Calendar task, and announces its end, on the device that owns the timer.
 * Other focus prompts keep their existing per-device settings.
 */
export function useFocusTones(
  focus: FocusSession | null,
  task: Task | null,
  ownsTimer: boolean,
  voice: Speaker
): void {
  const previous = useRef<{ key: string; remaining: number } | null>(null);

  // Phones block sound until the first tap; unlock quietly on any tap.
  useEffect(() => {
    const unlock = () => unlockTones();
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    if (!focus) {
      previous.current = null;
      return;
    }
    const key = `${focus.taskId}:${focus.duration}`;
    const before = previous.current;
    previous.current = { key, remaining: focus.remaining };
    // Only compare ticks of the same block, on the device running it.
    if (!ownsTimer || !before || before.key !== key) return;
    if (focus.remaining > before.remaining) return; // reset or restarted

    const settings = readToneSettings();
    const title = task?.title ?? "this task";
    const step = (focus.step || task?.nextAction || "")
      .trim()
      .replace(/[.!?;:,]+$/, "");
    const calendarTimer = isBookedClockTimedCalendarSchedule(task?.schedule);

    const missedCheckins = automaticCalendarChimeBoundaries(
      calendarTimer,
      focus.running,
      focus.duration,
      before.remaining,
      focus.remaining
    );
    const timerEnded = before.remaining > 0 && focus.remaining === 0;
    if (missedCheckins.length > 0) {
      const timerToneSettings = alwaysOnFocusToneSettings(settings);
      missedCheckins.forEach((_, index) => {
        window.setTimeout(
          () => playTone("chime", timerToneSettings),
          index * 450
        );
      });
      const repeatedTitle = automaticCheckInSpeech(
        title,
        missedCheckins.length,
        voice.speechSupported
      );
      if (timerEnded) {
        const endMessage =
          task?.state === "done"
            ? `The scheduled timebox is up for ${title}. The task is already complete; choose what to do next or take a break.`
            : `Focus time is up for ${title}. You can mark it done, take a short break, or start another block.`;
        window.setTimeout(
          () => playTone("end", timerToneSettings),
          missedCheckins.length * 450
        );
        const speech = [
          repeatedTitle,
          automaticTaskTitleSpeech(endMessage, voice.speechSupported),
        ]
          .filter(Boolean)
          .join(". ");
        if (speech) voice.read(speech);
      } else if (repeatedTitle) {
        voice.read(repeatedTitle);
      }
      return;
    }

    if (timerEnded) {
      const message =
        task?.state === "done"
          ? `The scheduled timebox is up for ${title}. The task is already complete; choose what to do next or take a break.`
          : `Focus time is up for ${title}. You can mark it done, take a short break, or start another block.`;
      playTone(
        "end",
        calendarTimer ? alwaysOnFocusToneSettings(settings) : settings
      );
      const speech = calendarTimer
        ? automaticTaskTitleSpeech(message, voice.speechSupported)
        : settings.enabled && settings.speak && voice.speechSupported
          ? message
          : null;
      if (speech) voice.read(speech);
      return;
    }

    const half = Math.floor(focus.duration / 2);
    if (
      settings.halfway &&
      focus.duration >= HALFWAY_MIN_SECONDS &&
      before.remaining > half &&
      focus.remaining <= half &&
      focus.remaining > 0
    ) {
      playTone("halfway", settings);
      if (settings.enabled && settings.speak && voice.speechSupported) {
        voice.read(
          `Halfway through ${title}.${step ? ` Still on: ${step}?` : ""} If you have drifted, tap I'm drifting for a two-minute restart.`
        );
      }
    }
  }, [focus, task, ownsTimer, voice]);
}
