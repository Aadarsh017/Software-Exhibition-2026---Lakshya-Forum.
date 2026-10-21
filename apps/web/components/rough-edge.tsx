/** A hand-cut section edge. The jitter is seeded, so every build looks identical (DESIGN.md 6.6). */
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

export function RoughEdge({ position, seed = 11 }: { position: "top" | "bottom"; seed?: number }) {
  const random = seeded(seed);
  const steps = 64;
  const points = ["0% 100%"];
  for (let i = 0; i <= steps; i += 1) {
    points.push(`${((i / steps) * 100).toFixed(2)}% ${(random() * 9 + 1).toFixed(1)}px`);
  }
  points.push("100% 100%");
  return (
    <div
      aria-hidden="true"
      className={`edge ${position === "top" ? "edge-top" : "edge-bottom"}`}
      style={{ clipPath: `polygon(${points.join(",")})` }}
    />
  );
}
