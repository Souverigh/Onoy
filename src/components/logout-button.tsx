"use client";
import { logout } from "@/app/auth/actions";
import { ConfirmButton } from "./confirm-button";

/** «Выйти» — только в Настройках и с подтверждением (аудит ТЗ 15.1 п. 8). */
export function LogoutButton() {
  return (
    <form action={logout}>
      <ConfirmButton
        className="button danger-outline"
        danger={false}
        message="Выйти из Depter на этом устройстве?"
        confirmLabel="Да, выйти"
      >
        Выйти из аккаунта
      </ConfirmButton>
    </form>
  );
}
