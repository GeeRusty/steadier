import React from "react";
import { Camera } from "lucide-react";
import { photosOf } from "../../domain/photos";
import type { Task } from "../../domain/types";

/** A card's photos: a small camera and the count, in the quiet meta line. Never a thumbnail, never a chip. */
export default function PhotoCountMark({ task }: { task: Pick<Task, "photos"> }) {
  const count = photosOf(task).length;
  if (!count) return null;
  return (
    <span className="tp-meta ph-count" aria-label={`${count} photo${count === 1 ? "" : "s"}`}>
      <Camera size={13} aria-hidden="true" /> {count}
    </span>
  );
}
