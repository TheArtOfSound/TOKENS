import { useEffect, useRef, useState } from "react";
import { animate } from "framer-motion";

// Smoothly animates a number toward `value`. `format` turns it into a string.
export default function AnimatedNumber({ value, format, duration = 1.8, testid }) {
  const [display, setDisplay] = useState(format(value || 0));
  const prev = useRef(value || 0);

  useEffect(() => {
    const from = prev.current;
    const to = value || 0;
    prev.current = to;
    const controls = animate(from, to, {
      duration,
      ease: "linear",
      onUpdate: (latest) => setDisplay(format(latest)),
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <span data-testid={testid} className="tabular-nums">
      {display}
    </span>
  );
}
