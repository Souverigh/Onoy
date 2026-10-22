"use client";

import { InfoTip } from "./info-tip";

/**
 * Исправление или повторное открытие записи: за кем она останется. Продавец
 * берётся из отменённой записи; владелец может выбрать другого сотрудника.
 */
export type Maker = {
  /** Отменённая запись, которую заменяет новая. */
  from: string;
  /** Продавец отменённой записи (null — старая запись без автора). */
  defaultId: string | null;
  /** Сотрудники магазина; пусто — пилюлю не показываем (продавец один). */
  options: { id: string; name: string }[];
  /** Выбрать другого может только владелец. */
  canChange: boolean;
};

/**
 * Пилюля «Продавец: Айбек» под клиентом и скрытые поля формы:
 * corrected_from и made_by (только если выбрали не того, кто был).
 */
export function MakerField({
  kind,
  maker,
  value,
  onChange,
}: {
  kind: "sale" | "purchase";
  maker: Maker;
  /** Выбранный продавец; пусто — как в отменённой записи. */
  value: string;
  onChange: (id: string) => void;
}) {
  const chosen = value || maker.defaultId || "";
  const options =
    maker.defaultId && !maker.options.some((o) => o.id === maker.defaultId)
      ? [...maker.options, { id: maker.defaultId, name: "Бывший сотрудник" }]
      : maker.options;
  const name = options.find((o) => o.id === chosen)?.name;
  const label = kind === "sale" ? "Продавец" : "Принял";
  return (
    <>
      <input type="hidden" name="corrected_from" value={maker.from} />
      {value && value !== maker.defaultId && <input type="hidden" name="made_by" value={value} />}
      {options.length > 1 && (name || maker.canChange) && (
        <div className="maker-field">
          <span className="maker-field-label">{label}:</span>
          {maker.canChange ? (
            <select
              className="maker-field-select"
              aria-label={label}
              value={chosen}
              onChange={(e) => onChange(e.target.value === maker.defaultId ? "" : e.target.value)}
            >
              {!chosen && <option value="">Не указан</option>}
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          ) : (
            <strong>{name}</strong>
          )}
          <InfoTip>
            {kind === "sale" ? "Продажа" : "Приход"} останется за этим сотрудником - в «Продавцах», истории и на
            накладной, даже если записываете вы.
          </InfoTip>
        </div>
      )}
    </>
  );
}
