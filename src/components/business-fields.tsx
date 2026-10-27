"use client";
import { useState } from "react";
import { BUSINESS_TYPES, MODULES, MODULE_IDS, PRESETS, type BusinessType, type ModuleId } from "@/lib/business";

/**
 * Вид бизнеса и разделы. Сменили вид — переключатели сразу встают по нему,
 * и их можно поправить до «Сохранить»: сохраняется то, что видно (раньше
 * смена вида при сохранении молча сбрасывала ручные правки).
 */
export function BusinessFields({ business, modules }: { business: BusinessType; modules: readonly ModuleId[] }) {
  const [type, setType] = useState(business);
  const [on, setOn] = useState<Set<ModuleId>>(() => new Set(modules));
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
    </>
  );
}
