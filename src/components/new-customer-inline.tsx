"use client";

import { useEffect, useState } from "react";
import { customerFromContact, supplierFromContact } from "@/app/(workspace)/money/actions";
import { bestMatches } from "@/lib/match";
import { phoneKey } from "@/lib/contacts";
import type { PickerParty } from "./party-picker";
import { IosAutofillHint, PhoneField, isIos } from "./contact-picker";
import { CURRENCIES, CURRENCY_SIGN, partyCurrency, type Currency } from "@/lib/currency";

/** «Долг будет в долларах». */
const IN_CURRENCY: Record<Currency, string> = { KGS: "сомах", USD: "долларах", RUB: "рублях" };

/** Похожее имя — «Похоже, это Айбек» (задача 24). */
const SAME_PERSON = 0.8;

type Created = { id: string; name: string; phone: string; balance: string; currency: string | null };

/**
 * Новый покупатель прямо в форме продажи (задача 11): фото и сумма не
 * теряются. Имя и телефон с накладной можно передать сразу. Тот же телефон
 * или похожее имя — сначала «Похоже, это Айбек. Выбрать его?» (задача 24).
 * `who="supplier"` — то же для поставщика в форме прихода. Валюта долга —
 * сразу при создании: после первой записи её не сменить.
 */
export function NewCustomerInline({
  who = "customer",
  customers,
  initialName = "",
  initialPhone = "",
  onCreated,
  onPickExisting,
  onClose,
  shopCurrency = "KGS",
  initialCurrency,
}: {
  who?: "customer" | "supplier";
  /** Валюта магазина — по умолчанию для нового клиента или поставщика. */
  shopCurrency?: Currency;
  /** Сумма в форме уже в $ — предлагаем $. */
  initialCurrency?: Currency;
  /** Уже есть в списке — для «Похоже, это …». */
  customers: PickerParty[];
  initialName?: string;
  initialPhone?: string;
  onCreated: (customer: Created) => void;
  onPickExisting: (id: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [currency, setCurrency] = useState<Currency>(initialCurrency ?? shopCurrency);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [lookalike, setLookalike] = useState<PickerParty | null>(null);
  const [ios, setIos] = useState(false);
  useEffect(() => setIos(isIos()), []);
  const word = who === "supplier" ? "поставщика" : "клиента";
  const otherCurrency = lookalike !== null && partyCurrency(lookalike, shopCurrency) !== currency;
  /** «ТестЕржан» → «ТестЕржан $»; знак уже есть в конце — не дублируем. */
  const withSign = (raw: string) => {
    const clean = raw.replace(/\s+/g, " ").trim();
    const sign = CURRENCY_SIGN[currency];
    return clean.toLowerCase().endsWith(sign.toLowerCase()) ? clean : `${clean} ${sign}`.slice(0, 160);
  };
  const create_ = (n: string, p: string, confirmedNew: boolean) =>
    who === "supplier" ? supplierFromContact(n, p, currency, confirmedNew) : customerFromContact(n, p, currency, confirmedNew);

  async function create(force: boolean, rename?: string) {
    const cleanName = (rename ?? name).replace(/\s+/g, " ").trim();
    if (!cleanName) {
      setNote(`Впишите имя ${word}.`);
      return;
    }
    if (!force) {
      const key = phoneKey(phone);
      const samePhone = key ? customers.find((c) => c.phone && phoneKey(c.phone) === key) : undefined;
      const sameName = bestMatches(cleanName, customers, 1, SAME_PERSON)[0]?.candidate;
      const twin = samePhone ?? sameName;
      if (twin) {
        setLookalike(twin);
        return;
      }
    }
    setSaving(true);
    setNote(null);
    try {
      const found = await create_(cleanName, phone, force);
      if ("error" in found) {
        setNote(`Не удалось добавить ${word}. Попробуйте ещё раз.`);
        return;
      }
      if (!found.created) {
        setNote(`${who === "supplier" ? "Поставщик" : "Клиент"} с этим телефоном уже есть: ${found.name}. Выбрали его.`);
        onPickExisting(found.id);
        return;
      }
      onCreated({ id: found.id, name: found.name, phone, balance: found.balance, currency: found.currency });
    } catch (err) {
      console.error("partyFromContact failed", err);
      setNote(`Нет связи с сервером - ${who === "supplier" ? "поставщик" : "клиент"} не добавлен. Попробуйте ещё раз.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="new-customer-inline" role="group" aria-label={who === "supplier" ? "Новый поставщик" : "Новый клиент"}>
      {lookalike ? (
        <div className="lookalike">
          <p>
            Похоже, это <strong>{lookalike.name}</strong>. Выбрать его?
          </p>
          {otherCurrency && (
            <p className="muted">
              Его долг ведётся в {IN_CURRENCY[partyCurrency(lookalike, shopCurrency)]}, а вы выбрали {CURRENCY_SIGN[currency]}. Нужен
              долг в {CURRENCY_SIGN[currency]} - нажмите «Нет, это новый»: появится отдельная карточка «{withSign(name)}».
            </p>
          )}
          <div className="simple-operation-actions">
            <button type="button" className="button primary" onClick={() => onPickExisting(lookalike.id)}>
              Да, это {lookalike.name}
            </button>
            <button
              type="button"
              className="button"
              onClick={() => {
                setLookalike(null);
                // Тот же человек, долг в другой валюте — знак валюты в имени,
                // чтобы две карточки не путали в списке.
                void create(true, otherCurrency ? withSign(name) : undefined);
              }}
            >
              Нет, это новый {who === "supplier" ? "поставщик" : "клиент"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <label>
            {who === "supplier" ? "Название поставщика" : "Имя клиента"}
            <input value={name} maxLength={160} autoComplete="name" onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Телефон (необязательно)
            <PhoneField
              onPick={(contact) => {
                if (contact.phone) setPhone(contact.phone);
                if (!name.trim() && contact.name) setName(contact.name);
              }}
            >
              <input
                value={phone}
                maxLength={40}
                type="tel"
                autoComplete="tel"
                placeholder="+996 …"
                onChange={(e) => setPhone(e.target.value)}
              />
            </PhoneField>
          </label>
          {ios && (
            <small className="muted">
              <IosAutofillHint />
            </small>
          )}
          <div className="new-party-currency">
            <span>В какой валюте долг</span>
            <span className="currency-pills" role="group" aria-label={`Валюта долга ${word}`}>
              {CURRENCIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={currency === c ? "active" : ""}
                  aria-pressed={currency === c}
                  onClick={() => setCurrency(c)}
                >
                  {CURRENCY_SIGN[c]}
                </button>
              ))}
            </span>
            <small className="muted">Долг будет в {IN_CURRENCY[currency]}. После первой записи валюту не сменить.</small>
          </div>
          {note && <p className="muted">{note}</p>}
          <div className="simple-operation-actions">
            <button type="button" className="button primary" disabled={saving} onClick={() => void create(false)}>
              {saving ? "Добавляем…" : `Добавить ${word}`}
            </button>
            <button type="button" className="text-button" onClick={onClose}>
              Отмена
            </button>
          </div>
        </>
      )}
    </div>
  );
}
