import { Compass, Volume2 } from "lucide-react";
import { GOAL_LEVEL_LABEL, type ChainStep } from "../../domain/goals";

/**
 * "Why am I doing this?" — the chain from a project up to its Pillars.
 * With `chains` and `onOpenGoal`, each step is a tappable link to its page;
 * the plain sentence is kept for screen readers and Read aloud.
 */
export default function WhyLine({
  text,
  onRead,
  chains,
  onOpenGoal,
}: {
  text: string;
  onRead?: (text: string) => void;
  chains?: ChainStep[][];
  onOpenGoal?: (id: string) => void;
}) {
  const read = () => {
    if (onRead) return onRead(text);
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    }
  };
  const linked = !!onOpenGoal && !!chains && chains.length > 0;
  return (
    <div className="why-line" aria-label="Why am I doing this?">
      <Compass size={15} aria-hidden="true" />
      <div className="why-body">
        {linked ? (
          <>
            <p className="small">
              <strong>Why:</strong>
            </p>
            <span className="sr-only">{text}</span>
            <ul className="why-chains" aria-hidden="false">
              {chains!.map((chain, n) => (
                <li key={n} className="small">
                  {chain.map((step, i) => (
                    <span key={step.goal.id}>
                      {i > 0 && <span className="muted"> › </span>}
                      <button
                        type="button"
                        className="why-step"
                        onClick={() => onOpenGoal!(step.goal.id)}
                        aria-label={`Open ${GOAL_LEVEL_LABEL[step.goal.level]} ${step.goal.title}`}
                      >
                        {step.goal.title}
                      </button>
                      {!step.confirmed && (
                        <span className="suggested-chip">suggested</span>
                      )}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="small">
            <strong>Why: </strong>
            {text}
          </p>
        )}
      </div>
      <button
        type="button"
        className="text-button"
        onClick={read}
        aria-label="Read why aloud"
      >
        <Volume2 size={14} />
      </button>
    </div>
  );
}
