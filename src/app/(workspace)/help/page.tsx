import Link from "next/link";
import { getContext } from "@/lib/context";
import { bishkekDate } from "@/lib/day-summary";
import { helpQuestions } from "@/lib/help";
import { supportHref } from "@/components/contact-links";
import { SupportCard } from "@/components/support-card";
import { TeachExample } from "@/components/teach";

/** «Помощь»: частые вопросы (src/lib/help.ts) и поддержка в WhatsApp. */
export default async function HelpPage() {
  const { organizationName, currency, isOwner } = await getContext();
  const questions = helpQuestions({ currency, shopName: organizationName, today: bishkekDate(), isOwner });
  const support = supportHref(organizationName, "раздел «Помощь»");
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Помощь</h1>
          <p className="muted">Частые вопросы и поддержка.</p>
        </div>
      </div>
      <section className="panel help-faq" aria-label="Частые вопросы">
        {questions.map((h) => (
          <details key={h.id} id={h.id}>
            <summary>{h.q}</summary>
            <div className="teach">
              <p>{h.a}</p>
              {h.rows && <TeachExample rows={h.rows} message={h.message} />}
              {h.button && (
                <div className="teach-actions">
                  <Link className="button primary" href={h.button.href}>
                    {h.button.label}
                  </Link>
                </div>
              )}
            </div>
          </details>
        ))}
      </section>
      <SupportCard
        title="Не нашли ответ?"
        text="Напишите нам в WhatsApp - ответит человек, поможем разобраться."
        href={support}
      />
    </>
  );
}
