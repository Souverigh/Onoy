"use client";

import { useState } from "react";
import { customerFromContact } from "@/app/(workspace)/money/actions";
import { bestMatches } from "@/lib/match";
import { phoneKey } from "@/lib/contacts";
import type { PickerParty } from "./party-picker";
import { PhoneField } from "./contact-picker";

/** Похожее имя — «Похоже, это Айбек» (задача 24). */
const SAME_PERSON = 0.8;

type Created = { id: string; name: string; phone: string; balance: string };

/**
 * Новый покупатель прямо в форме продажи (задача 11): фото и сумма не
 * теряются. Имя и телефон с накладной можно передать сразу. Тот же телефон
 * или похожее имя — сначала «Похоже, это Айбек. Выбрать его?» (задача 24).
 */
export function NewCustomerInline({
  customers,
  initialName = "",
  initialPhone = "",
  onCreated,
  onPickExisting,
  onClose,
}: {
  customers: PickerParty[];
  initialName?: string;
  initialPhone?: string;
  onCreated: (customer: Created) => void;
  onPickExisting: (id: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [lookalike, setLookalike] = useState<PickerParty | null>(null);

  async function create(force: boolean) {
    const cleanName = name.replace(/\s+/g, " ").trim();
    if (!cleanName) {
      setNote("Впишите имя клиента.");
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
      const found = await customerFromContact(cleanName, phone);
      if ("error" in found) {
        setNote("Не удалось добавить клиента. Попробуйте ещё раз.");
        return;
      }
      if (!found.created) {
        setNote(`Клиент с этим телефоном уже есть: ${found.name}. Выбрали его.`);
        onPickExisting(found.id);
        return;
      }
      onCreated({ id: found.id, name: found.name, phone, balance: found.balance });
    } catch (err) {
      console.error("customerFromContact failed", err);
      setNote("Нет связи с сервером — клиент не добавлен. Попробуйте ещё раз.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="new-customer-inline" role="group" aria-label="Новый клиент">
      {lookalike ? (
        <div className="lookalike">
          <p>
            Похоже, это <strong>{lookalike.name}</strong>. Выбрать его?
          </p>
          <div className="simple-operation-actions">
            <button type="button" className="button primary" onClick={() => onPickExisting(lookalike.id)}>
              Да, это {lookalike.name}
            </button>
            <button
              type="button"
              className="button"
              onClick={() => {
                setLookalike(null);
                void create(true);
              }}
            >
              Нет, это новый клиент
            </button>
          </div>
        </div>
      ) : (
        <>
          <label>
            Имя клиента
            <input value={name} maxLength={160} autoComplete="off" onChange={(e) => setName(e.target.value)} />
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
                inputMode="tel"
                autoComplete="off"
                placeholder="+996 …"
                onChange={(e) => setPhone(e.target.value)}
              />
            </PhoneField>
          </label>
          {note && <p className="muted">{note}</p>}
          <div className="simple-operation-actions">
            <button type="button" className="button primary" disabled={saving} onClick={() => void create(false)}>
              {saving ? "Добавляем…" : "Добавить клиента"}
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
