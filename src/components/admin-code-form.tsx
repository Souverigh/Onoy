"use client";
import { useActionState } from "react";
import { verifyAdminCode } from "@/app/admin/actions";
import { Submit } from "./submit";

const errors: Record<string, string> = {
  code: "Код не подошёл. Проверьте 6 цифр - код меняется каждые 30 секунд.",
  rate: "Слишком много попыток. Подождите минуту.",
  failed: "Не получилось. Обновите страницу.",
};

/**
 * Ввод кода из приложения. Ошибка приходит ответом, без перезагрузки:
 * при подключении QR остаётся тем же, что уже отсканировали.
 * next="team" — ещё один телефон из «Команды», после кода — обратно туда.
 */
export function AdminCodeForm({ factorId, next, label = "Подтвердить" }: { factorId: string; next?: "team"; label?: string }) {
  const [state, action] = useActionState(verifyAdminCode, null);
  return (
    <form action={action}>
      <input type="hidden" name="factor" value={factorId} />
      {next && <input type="hidden" name="next" value={next} />}
      {state?.error && (
        <p className="form-error" role="alert">
          {errors[state.error] ?? errors.failed}
        </p>
      )}
      <label>
        Код
        <input
          className="adm-code-input"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          required
          autoFocus
          placeholder="000000"
        />
      </label>
      <Submit>{label}</Submit>
    </form>
  );
}
