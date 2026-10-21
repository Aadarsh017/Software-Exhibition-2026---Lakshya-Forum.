import { formatPrepared, type SummaryContent } from "@/lib/summary/content";
import { MEDICINES_HEADING, MEDICINES_NOTE, type PersonalSections } from "@/lib/summary/personal";
import { LogoMark } from "@/components/nox";

/**
 * The visit summary, the same on screen and on paper (DESIGN.md 8.7): black on white when printed, statuses as words,
 * no fake patient ID, the name only if the person typed one.
 */
export function DoctorSummary({ content, personal = null }: { content: SummaryContent; personal?: PersonalSections | null }) {
  const s = content.summary;
  return (
    <article className="doc card" aria-label="Visit summary">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-display text-[1.125rem] font-extrabold">
          <LogoMark size={24} /> hale
        </span>
        <span className="font-semibold">Visit summary</span>
      </header>
      <div className="grid gap-1">
        <h1 className="doc-title">{s.title}</h1>
        <p className="m-0 text-[0.9375rem] text-[var(--ink-muted)]">
          Prepared {formatPrepared(content.prepared_at)}
          {content.for_name ? ` · For: ${content.for_name}` : ""}
        </p>
      </div>

      {s.reason_for_visit ? (
        <section>
          <h2>Why I&apos;m seeing you</h2>
          <p className="m-0">{s.reason_for_visit}</p>
        </section>
      ) : null}

      {s.timeline.length ? (
        <section>
          <h2>What&apos;s been happening</h2>
          <table>
            <tbody>
              {s.timeline.map((row, index) => (
                <tr key={index}>
                  <td>{row.when}</td>
                  <td>{row.what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {s.details.length ? (
        <section>
          <h2>Details</h2>
          <table>
            <tbody>
              {s.details.map((row, index) => (
                <tr key={index}>
                  <td>{row.label}</td>
                  <td>{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {s.medicines_and_allergies.length ? (
        <section>
          <h2>Medicines and allergies I mentioned</h2>
          <ul>
            {s.medicines_and_allergies.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {s.warning_signs.present.length || s.warning_signs.not_present.length ? (
        <section>
          <h2>Warning signs I checked</h2>
          {s.warning_signs.present.length ? (
            <p className="m-0">
              <strong>Present:</strong> {s.warning_signs.present.join(", ")}
            </p>
          ) : null}
          {s.warning_signs.not_present.length ? (
            <p className="m-0">
              <strong>Not present:</strong> {s.warning_signs.not_present.join(", ")}
            </p>
          ) : null}
        </section>
      ) : null}

      {s.questions.length ? (
        <section>
          <h2>Questions I want to ask</h2>
          <ul className="list-none" style={{ paddingLeft: 0 }}>
            {s.questions.map((question) => (
              <li key={question}>☐ {question}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {personal?.about.length ? (
        <section>
          <h2>About me</h2>
          <ul>
            {personal.about.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {personal?.blood.length ? (
        <section>
          <h2>My recent blood results (typed from my reports)</h2>
          <ul>
            {personal.blood.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {personal?.readings.length ? (
        <section>
          <h2>My home readings, last 2 weeks</h2>
          <ul>
            {personal.readings.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {personal?.medicines.length ? (
        <section>
          <h2>{MEDICINES_HEADING}</h2>
          <ul>
            {personal.medicines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="m-0 text-[0.875rem] text-[var(--ink-muted)]">{MEDICINES_NOTE}</p>
        </section>
      ) : null}

      {personal?.diary.length ? (
        <section>
          <h2>My health diary, last 2 weeks</h2>
          <ul>
            {personal.diary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h2>My notes</h2>
        {content.notes.trim() ? (
          <p className="m-0 whitespace-pre-wrap">{content.notes}</p>
        ) : (
          <div className="doc-lines" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        )}
      </section>

      <p className="doc-foot m-0">Prepared from my own words with Hale. Not a medical record or a diagnosis.</p>
    </article>
  );
}
