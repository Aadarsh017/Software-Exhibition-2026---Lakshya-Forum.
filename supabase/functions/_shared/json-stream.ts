// Reads a JSON object while it is still arriving and reports each top-level field the moment its
// value is complete, so the answer can be shown field by field. Text before the first "{" (such as
// a code fence) is skipped; anything after the closing "}" is ignored.
//
//   const fields = createFieldStream((name, value) => …);
//   fields.push('{"care_level": "doc'); fields.push('tor", "headline": …');
//   fields.end() → { fields, complete }

export type FieldStream = {
  push(chunk: string): void;
  end(): { fields: Record<string, unknown>; complete: boolean };
};

const SPACE = /\s/;

export function createFieldStream(onField: (name: string, value: unknown) => void): FieldStream {
  let text = "";
  let i = 0;
  let started = false;
  let finished = false;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let phase: "key" | "colon" | "value" = "key";
  let keyStart = -1;
  let key = "";
  let valueStart = -1;
  const fields: Record<string, unknown> = {};

  const emit = (end: number) => {
    const raw = text.slice(valueStart, end).trim();
    phase = "key";
    valueStart = -1;
    if (!key) return;
    try {
      const value = JSON.parse(raw);
      fields[key] = value;
      onField(key, value);
    } catch {
      // a malformed value: skip this field, keep reading the others
    }
  };

  return {
    push(chunk) {
      text += chunk;
      for (; i < text.length && !finished; i++) {
        const c = text[i];
        if (!started) {
          if (c === "{") {
            started = true;
            depth = 1;
          }
          continue;
        }
        if (inString) {
          if (escaped) escaped = false;
          else if (c === "\\") escaped = true;
          else if (c === '"') {
            inString = false;
            if (depth === 1 && phase === "key") {
              try {
                key = String(JSON.parse(text.slice(keyStart, i + 1)));
              } catch {
                key = "";
              }
              phase = "colon";
            } else if (depth === 1 && phase === "value") {
              emit(i + 1);
            }
          }
          continue;
        }
        if (c === '"') {
          inString = true;
          if (depth === 1 && phase === "key") keyStart = i;
          else if (depth === 1 && phase === "value" && valueStart === -1) valueStart = i;
          continue;
        }
        if (depth === 1) {
          if (phase === "colon") {
            if (c === ":") phase = "value";
            continue;
          }
          if (phase === "value") {
            if (valueStart === -1) {
              if (SPACE.test(c)) continue;
              if (c === "," || c === "}") {
                phase = "key"; // empty value: malformed, skip it
                if (c === "}") finished = true;
                continue;
              }
              valueStart = i;
              if (c === "{" || c === "[") depth++;
              continue;
            }
            if (c === "," || c === "}") {
              emit(i); // end of a number, true, false or null
              if (c === "}") finished = true;
            }
            continue;
          }
          if (c === "}") finished = true;
          continue;
        }
        if (c === "{" || c === "[") depth++;
        else if (c === "}" || c === "]") {
          depth--;
          if (depth === 1) emit(i + 1);
        }
      }
    },
    end() {
      return { fields, complete: finished };
    },
  };
}
