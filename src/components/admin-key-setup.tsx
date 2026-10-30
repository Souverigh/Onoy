import { AdminCodeForm } from "./admin-code-form";

/** QR для Google Authenticator, ключ вручную и ввод кода — подключение телефона. */
export function AdminKeySetup({
  setup,
  next,
  label,
}: {
  setup: { factorId: string; qr: string; secret: string };
  next?: "team";
  label?: string;
}) {
  return (
    <>
      <ol className="adm-mfa-steps">
        <li>Установите на телефон Google Authenticator.</li>
        <li>В приложении нажмите «+» → «Сканировать QR-код» и наведите камеру на код ниже.</li>
        <li>Введите 6 цифр, которые покажет приложение.</li>
      </ol>
      {/* QR приходит от Supabase готовой картинкой (SVG data URL). */}
      <img className="adm-mfa-qr" src={setup.qr} alt="QR-код для Google Authenticator" width={180} height={180} />
      <details className="adm-mfa-secret">
        <summary>Не сканируется? Ввести ключ вручную</summary>
        <code>{setup.secret}</code>
      </details>
      <AdminCodeForm factorId={setup.factorId} next={next} label={label} />
      <small className="muted">Обновили страницу - отсканируйте новый QR, старый уже не подойдёт.</small>
    </>
  );
}
