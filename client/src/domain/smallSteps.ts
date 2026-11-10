export interface SmallStepIdentity {
  id: string;
}

/** Remove exactly one selected Small step, preserving the order and data of the rest. */
export function removeSmallStep<T extends SmallStepIdentity>(
  steps: readonly T[],
  stepId: string
): T[] {
  return steps.filter(step => step.id !== stepId);
}
