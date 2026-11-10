import { emptyProjectCompass } from "./compass";
import { emptyProjectSchedule } from "./time";
import { addDays } from "./engine";
import type {
  LifePattern,
  LifeRole,
  MatrixCell,
  MatrixWeights,
  Project,
  Task,
} from "./types";

export const MATRIX_CELLS: MatrixCell[] = [
  "direction-timely",
  "direction-sustained",
  "support-timely",
  "support-sustained",
];

/** All parts of life begin equally represented. Emphasis is a tie-breaker only. */
export const DEFAULT_MATRIX_WEIGHTS: MatrixWeights = {
  "direction-timely": 1,
  "direction-sustained": 1,
  "support-timely": 1,
  "support-sustained": 1,
};

function isCalendarDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function suggestedRole(title: string): LifeRole | null {
  const text = title.toLocaleLowerCase();
  const soundsLikeSupport =
    /\b(?:renew(?:al)?|licen[cs]e|bill|service|mainten(?:ance|ain))\b/.test(
      text
    );
  const soundsLikeDirection =
    /\b(?:creative|develop(?:ment|ing|ed)?|learn(?:ing|ed)?|project)\b/.test(
      text
    );

  // If a title contains signals from both roles, it is too ambiguous to label.
  if (soundsLikeSupport === soundsLikeDirection) return null;
  return soundsLikeSupport ? "support" : "direction";
}

function suggestedPattern(
  input: Partial<Task> & { title: string }
): LifePattern | null {
  if (isCalendarDate(input.deadline)) return "timely";
  if (
    /\b(?:routine|repeat(?:ing|ed|s)?|recurr(?:ing|ence)?|regular(?:ly)?)\b/.test(
      input.title.toLocaleLowerCase()
    )
  ) {
    return "sustained";
  }
  return null;
}

/**
 * Offer only plain-language, reversible identity hints. This never adds a real
 * deadline or treats an ambiguous title as a meaningful life decision.
 */
export function suggestIdentity(
  input: Partial<Task> & { title: string },
  day: string
): Partial<Task> {
  // `day` belongs to the public contract so suggestions can remain explicitly
  // date-contextual. Preparation is deliberately calculated from a real
  // supplied deadline rather than from this current day.
  void day;
  const result: Partial<Task> = { ...input };
  const labelsAreConfirmed = input.labelSource === "confirmed";
  let addedIdentity = false;

  if (!labelsAreConfirmed && input.role == null) {
    const role = suggestedRole(input.title);
    if (role) {
      result.role = role;
      addedIdentity = true;
    }
  }

  if (!labelsAreConfirmed && input.pattern == null) {
    const pattern = suggestedPattern(input);
    if (pattern) {
      result.pattern = pattern;
      addedIdentity = true;
    }
  }

  if (addedIdentity) result.labelSource = "suggested";

  // An explicit blank/null preparation date is meaningful too, so only suggest
  // one when neither the date nor its provenance was supplied by the user.
  if (
    input.preparationDate === undefined &&
    input.preparationSource === undefined &&
    isCalendarDate(input.deadline)
  ) {
    const sevenDaysEarlier = addDays(input.deadline, -7);
    const availableFrom = isCalendarDate(input.startDate)
      ? input.startDate
      : null;

    // A preparation date after its deadline would not clarify anything. When a
    // valid available-from date is later than the seven-day point, use it so we
    // do not suggest preparation before work is available.
    if (!availableFrom || availableFrom <= input.deadline) {
      result.preparationDate =
        availableFrom && availableFrom > sevenDaysEarlier
          ? availableFrom
          : sevenDaysEarlier;
      result.preparationSource = "suggested";
    }
  }

  return result;
}

/** A calm human-readable summary, with provisional suggestions made explicit. */
export function identityLabel(task: Task): string {
  const role = task.role
    ? task.role === "direction"
      ? "Direction"
      : "Support"
    : null;
  const pattern = task.pattern
    ? task.pattern === "timely"
      ? "Timely"
      : "Sustained"
    : null;
  const label = [role, pattern].filter(Boolean).join(" · ");
  if (!label) return "Unclassified";
  return task.labelSource === "suggested" ? `${label} (provisional)` : label;
}

/** Return a matrix cell only when both dimensions have been deliberately set. */
export function matrixKey(task: Task): MatrixCell | null {
  if (!task.role || !task.pattern) return null;
  return `${task.role}-${task.pattern}` as MatrixCell;
}

/** Invalid/missing weights return to a neutral one rather than creating hierarchy. */
export function matrixWeight(
  task: Task,
  weights: MatrixWeights | Partial<MatrixWeights> | null | undefined
): number {
  const key = matrixKey(task);
  const weight = key ? weights?.[key] : undefined;
  return Number.isInteger(weight) && weight! >= 1 && weight! <= 3 ? weight! : 1;
}

interface SampleProjectSpec {
  id: string;
  title: string;
  purpose: string;
  outcome: string;
  role: LifeRole;
  pattern: LifePattern;
}

const SAMPLE_PROJECTS: SampleProjectSpec[] = [
  {
    id: "sample-project-garage-workspace",
    title: "Make the garage a usable workspace",
    purpose: "Make ordinary repairs and maintenance easier to begin at home.",
    outcome:
      "A clear, safe workbench and the tools for common jobs are easy to find and use.",
    role: "direction",
    pattern: "sustained",
  },
  {
    id: "sample-project-dependable-legal-vehicles",
    title: "Keep vehicles dependable and legal",
    purpose:
      "Keep the van and trailer serviceable, safe, and ready for the work they carry.",
    outcome:
      "The needed service, safety-kit, and compliance checks have clear next steps or evidence.",
    role: "support",
    pattern: "sustained",
  },
  {
    id: "sample-project-trailer-hire-ready",
    title: "Make trailer hire ready to take bookings",
    purpose:
      "Turn the trailer-hire idea into a clear offer that customers can understand.",
    outcome:
      "A customer can understand the offer and make an enquiry or booking from one clear page.",
    role: "direction",
    pattern: "timely",
  },
];

const SAMPLE_TASK_LINKS: Record<string, string> = {
  "sample-garage-shelf": "sample-project-garage-workspace",
  "sample-tool-inventory": "sample-project-garage-workspace",
  "sample-van-service": "sample-project-dependable-legal-vehicles",
  "sample-first-aid": "sample-project-dependable-legal-vehicles",
  "sample-website-copy": "sample-project-trailer-hire-ready",
  "sample-trailer-page": "sample-project-trailer-hire-ready",
  "sample-trailer-listing": "sample-project-trailer-hire-ready",
};

/**
 * Add curated project framing to sample data only. No task is added, removed,
 * or linked merely because it shares a life area.
 */
export function makeSampleProjects(
  tasks: Task[],
  day: string
): { tasks: Task[]; projects: Project[] } {
  const projectById = new Map(
    SAMPLE_PROJECTS.map(project => [project.id, project])
  );
  const stamp = `${day}T09:00:00`;

  const enrichedTasks = tasks.map(task => {
    const projectId = SAMPLE_TASK_LINKS[task.id];
    const project = projectId ? projectById.get(projectId) : undefined;
    if (!project) return { ...task };

    const labelSource: Task["labelSource"] =
      task.labelSource === "confirmed" ? "confirmed" : "suggested";

    return {
      ...task,
      // Do not displace any existing sample identity/relationship metadata.
      projectId: task.projectId ?? project.id,
      role: task.role ?? project.role,
      pattern: task.pattern ?? (task.deadline ? "timely" : project.pattern),
      purpose: task.purpose || project.purpose,
      labelSource,
    };
  });

  const projects: Project[] = SAMPLE_PROJECTS.map(project => ({
    ...project,
    status: "active",
    milestones: [],
    progress: [],
    createdAt: stamp,
    updatedAt: stamp,
    schedule: emptyProjectSchedule(),
    compass: emptyProjectCompass(),
  }));

  return { tasks: enrichedTasks, projects };
}
