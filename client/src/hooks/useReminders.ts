import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { Task } from "../domain/types";
import { dueReminders } from "../domain/reminders";
import { playTone, readToneSettings } from "../lib/tones";

const FIRED_KEY = "steadier.reminders.fired.v1";
const CHECK_MS = 15_000;

function readFired(): Set<string> {
  try {
    const raw = window.localStorage.getItem(FIRED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}
function writeFired(fired: Set<string>) {
  try {
    window.localStorage.setItem(
      FIRED_KEY,
      JSON.stringify([...fired].slice(-300))
    );
  } catch {
    // Without storage a reminder may ring again after reload; harmless.
  }
}

export async function systemNotify(title: string, body: string) {
  if (
    typeof Notification === "undefined" ||
    Notification.permission !== "granted"
  )
    return;
  try {
    const registration = await navigator.serviceWorker?.getRegistration?.();
    if (registration) {
      await registration.showNotification(title, {
        body,
        tag: title,
        icon: "/favicon.ico",
      });
      return;
    }
    new Notification(title, { body, tag: title });
  } catch {
    // System notifications are optional; the in-app toast always shows.
  }
}

type Speaker = { read: (text: string) => void; speechSupported: boolean };

/**
 * Rings in-app reminders while Steadier is open: a chime, vibration, a toast
 * with "Open", an optional spoken line and (if allowed) a system notification.
 * Each reminder rings once per device, within 10 minutes of its time.
 */
export function useReminders(
  tasks: Task[],
  voice: Speaker,
  onOpen: (taskId: string) => void
): void {
  const latest = useRef({ tasks, voice, onOpen });
  latest.current = { tasks, voice, onOpen };
  useEffect(() => {
    const check = () => {
      const settings = readToneSettings();
      const fired = readFired();
      const due = dueReminders(latest.current.tasks, new Date(), fired);
      if (!due.length) return;
      for (const reminder of due) fired.add(reminder.key);
      writeFired(fired);
      if (settings.reminders) playTone("reminder", settings);
      for (const reminder of due) {
        toast(reminder.title, {
          description: reminder.body,
          duration: 60_000,
          action: {
            label: "Open",
            onClick: () => latest.current.onOpen(reminder.taskId),
          },
        });
        if (document.visibilityState !== "visible")
          void systemNotify(reminder.title, reminder.body);
      }
      if (
        settings.reminders &&
        settings.speak &&
        latest.current.voice.speechSupported
      ) {
        const first = due[0];
        latest.current.voice.read(
          due.length === 1
            ? `Reminder: ${first.title}. ${first.body}.`
            : `${due.length} reminders. First: ${first.title}.`
        );
      }
    };
    check();
    const id = window.setInterval(check, CHECK_MS);
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}
