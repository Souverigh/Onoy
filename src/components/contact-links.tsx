/** Связь с Depter: Telegram и WhatsApp на один номер. */
export const DEPTER_PHONE = "+996 773 033 399";
const digits = DEPTER_PHONE.replace(/\D/g, "");

export function ContactLinks({ showPhone = false }: { showPhone?: boolean }) {
  return (
    <div className="contact-links">
      <a href={`https://t.me/+${digits}`} target="_blank" rel="noopener noreferrer" aria-label="Написать в Telegram" title="Telegram">
        <svg width="40" height="40" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="12" fill="#2aabee" />
          <path
            fill="#fff"
            d="M5.4 11.8 17.2 7.2c.55-.2 1.03.13.85.97l-2 9.45c-.15.67-.55.83-1.1.52l-3.05-2.25-1.47 1.42c-.16.16-.3.3-.62.3l.22-3.1 5.65-5.1c.25-.22-.05-.34-.38-.12l-6.98 4.4-3-.94c-.66-.2-.67-.65.13-.97Z"
          />
        </svg>
      </a>
      <a href={`https://wa.me/${digits}`} target="_blank" rel="noopener noreferrer" aria-label="Написать в WhatsApp" title="WhatsApp">
        <svg width="40" height="40" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="12" fill="#25d366" />
          <path
            fill="none"
            stroke="#fff"
            strokeWidth="1.4"
            strokeLinejoin="round"
            d="M12 5.5a6.5 6.5 0 0 0-5.6 9.8l-.9 3.2 3.3-.87A6.5 6.5 0 1 0 12 5.5Z"
          />
          <path
            fill="#fff"
            d="M9.6 8.9c.15-.33.3-.34.45-.34h.38c.13 0 .3.05.46.4l.6 1.4c.05.12.08.27 0 .42l-.3.43c-.1.13-.2.25-.08.47.5.85 1.2 1.55 2.07 2.03.2.12.34.1.46-.05l.5-.6c.13-.16.27-.13.44-.07l1.4.66c.17.08.28.12.32.2.05.08.05.47-.1.92-.17.45-.95.87-1.33.9-.35.04-.78.17-2.6-.56-2.2-.88-3.6-3.14-3.7-3.29-.11-.14-.88-1.17-.88-2.24 0-1.06.56-1.58.76-1.8Z"
          />
        </svg>
      </a>
      {showPhone && <a href={`tel:+${digits}`}>{DEPTER_PHONE}</a>}
    </div>
  );
}
