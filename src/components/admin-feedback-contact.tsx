import { feedbackWaText, isEmail, type FeedbackRow } from "@/lib/admin-feedback";
import { waPhone } from "@/lib/share";

/** Как связаться по заявке: телефон — WhatsApp и звонок, email — письмо. */
export function feedbackContact(f: FeedbackRow) {
  if (isEmail(f.contact)) return { email: f.contact.trim(), phone: null };
  const digits = waPhone(f.contact);
  return { email: null, phone: digits.length >= 9 ? digits : null };
}

/** Кнопки связи по заявке. short — у звонка только значок (в списке). */
export function FeedbackContactButtons({ f, short = false }: { f: FeedbackRow; short?: boolean }) {
  const c = feedbackContact(f);
  if (c.phone)
    return (
      <span className="adm-contact-acts">
        <a
          className="adm-contact"
          href={`https://wa.me/${c.phone}?text=${encodeURIComponent(feedbackWaText(f.name))}`}
          target="_blank"
          rel="noopener noreferrer"
          title="WhatsApp"
        >
          <span aria-hidden="true">💬</span>
          <span className="adm-contact-text">WhatsApp</span>
        </a>
        <a className="adm-contact" href={`tel:+${c.phone}`} title="Позвонить" aria-label="Позвонить">
          <span aria-hidden="true">📞</span>
          {!short && <span className="adm-contact-text">Позвонить</span>}
        </a>
      </span>
    );
  if (c.email)
    return (
      <a className="adm-contact" href={`mailto:${c.email}`} title="Письмо">
        <span aria-hidden="true">✉</span>
        <span className="adm-contact-text">Письмо</span>
      </a>
    );
  return null;
}
