"use client";
import { logout } from "@/app/auth/actions";

/** «Выйти» — только в Настройках и с подтверждением (аудит ТЗ 15.1 п. 8). */
export function LogoutButton() {
  return (
    <form
      action={logout}
      onSubmit={(e) => {
        if (!window.confirm("Выйти из Depter на этом устройстве?")) e.preventDefault();
      }}
    >
      <button type="submit" className="button danger-outline">
        Выйти из аккаунта
      </button>
    </form>
  );
}
