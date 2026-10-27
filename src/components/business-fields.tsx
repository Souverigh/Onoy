"use client";
import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  BUSINESS_TYPES,
  MODULES,
  MODULE_IDS,
  PRESETS,
  businessChangeWarnings,
  type BusinessType,
  type ModuleId,
  type ShopStats,
} from "@/lib/business";
import { ConfirmDialog } from "./confirm-dialog";

/**
 * Вид бизнеса и разделы. Сменили вид — переключатели сразу встают по нему,
 * и их можно поправить до «Сохранить»: сохраняется то, что видно. Перед
 * сохранением — окно «Что изменится» с цифрами магазина (вещи на руках,
 * открытый каталог), если что-то скроется или сменится главная кнопка.
 */
export function BusinessFields({
  business,
  modules,
  stats,
}: {
  business: BusinessType;
  modules: readonly ModuleId[];
  stats: ShopStats;
}) {
  const [type, setType] = useState(business);
  const [on, setOn] = useState<Set<ModuleId>>(() => new Set(modules));
  const [asking, setAsking] = useState<string[] | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const confirmed = useRef(false);
  const { pending } = useFormStatus();
  return (
    <>
      <label>
        Чем вы занимаетесь
        <select
          name="business_type"
          value={type}
          onChange={(e) => {
            const next = e.target.value as BusinessType;
            setType(next);
            setOn(new Set(PRESETS[next].modules));
          }}
        >
          {BUSINESS_TYPES.map((t) => (
            <option key={t} value={t}>
              {PRESETS[t].label}
            </option>
          ))}
        </select>
        <small className="muted">Выбрали вид - разделы ниже встали по нему. Поправьте, если нужно, и сохраните.</small>
      </label>
      {MODULE_IDS.map((id) => (
        <label className="setting-switch" key={id}>
          <span>
            <strong>{MODULES[id].label}</strong>
            <small className="muted">{MODULES[id].description}</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            name="modules"
            value={id}
            checked={on.has(id)}
            onChange={(e) =>
              setOn((prev) => {
                const next = new Set(prev);
                if (e.target.checked) next.add(id);
                else next.delete(id);
                return next;
              })
            }
          />
        </label>
      ))}
      <small className="muted settings-hint">
        Выключенный раздел только скрыт из меню - всё, что в нём записано, сохраняется и вернётся, если включить.
      </small>
      <div className="settings-save">
        <button
          ref={button}
          className="button primary"
          type="submit"
          disabled={pending}
          onClick={(e) => {
            if (confirmed.current) {
              confirmed.current = false;
              return;
            }
            const warnings = businessChangeWarnings(
              { type: business, modules },
              { type, modules: MODULE_IDS.filter((id) => on.has(id)) },
              stats,
            );
            if (!warnings.length) return;
            e.preventDefault();
            setAsking(warnings);
          }}
        >
          {pending ? "Сохраняем…" : "Сохранить"}
        </button>
      </div>
      <ConfirmDialog
        open={asking != null}
        title="Что изменится"
        text={
          <ul className="business-change-list">
            {(asking ?? []).map((w) => (
              <li key={w}>{w}</li>
            ))}
            <li className="muted">Записи и данные не меняются. Вернуть прежний вид можно в течение суток.</li>
          </ul>
        }
        confirmLabel="Сменить"
        cancelLabel="Отмена"
        onConfirm={() => {
          setAsking(null);
          confirmed.current = true;
          button.current?.click();
        }}
        onCancel={() => setAsking(null)}
      />
    </>
  );
}
