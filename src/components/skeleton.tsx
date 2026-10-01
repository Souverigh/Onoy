/**
 * Серые макеты страниц для loading.tsx: страница появляется сразу после
 * нажатия, данные дорисовываются следом. Next подгружает эти макеты для
 * ссылок на экране заранее. Только вёрстка — без данных и без JS.
 */
function Bar({ w = "100%", h = 14 }: { w?: string | number; h?: number }) {
  return <span className="skeleton" style={{ width: w, height: h }} />;
}

/** Заголовок страницы: надпись + крупный заголовок + подпись. */
export function SkeletonHeading({ subtitle = true }: { subtitle?: boolean }) {
  return (
    <div className="page-heading skeleton-heading">
      <div>
        <Bar w={110} h={9} />
        <Bar w={190} h={30} />
        {subtitle && <Bar w={260} h={12} />}
      </div>
    </div>
  );
}

/** Плитки (кнопки действий, суммы долгов). */
export function SkeletonTiles({ count, className }: { count: number; className: string }) {
  return (
    <div className={className}>
      {Array.from({ length: count }, (_, i) => (
        <div className="panel skeleton-tile" key={i}>
          <Bar w="55%" h={12} />
          <Bar w="35%" h={22} />
        </div>
      ))}
    </div>
  );
}

/** Список строк в панели: «имя — сумма», под ним дата. */
export function SkeletonList({ rows = 6, title = true }: { rows?: number; title?: boolean }) {
  return (
    <section className="panel">
      {title && <Bar w={170} h={18} />}
      <ul className="skeleton-list">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i}>
            <span>
              <Bar w={`${55 + ((i * 17) % 30)}%`} h={14} />
              <Bar w="30%" h={10} />
            </span>
            <Bar w={70} h={14} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Форма: подписи и поля, кнопка внизу. */
export function SkeletonForm({ fields = 4 }: { fields?: number }) {
  return (
    <section className="panel skeleton-form">
      <span className="skeleton skeleton-dropzone" />
      {Array.from({ length: fields }, (_, i) => (
        <div key={i}>
          <Bar w={120} h={11} />
          <Bar h={46} />
        </div>
      ))}
      <Bar h={50} />
    </section>
  );
}

/** Фото документа рядом со строками накладной. */
export function SkeletonDocument() {
  return (
    <div className="skeleton-document">
      <span className="skeleton skeleton-photo" />
      <SkeletonList rows={8} />
    </div>
  );
}

/** Подпись для экранных дикторов: страница грузится. */
export function SkeletonPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="skeleton-page" role="status" aria-busy="true">
      <span className="sr-only">Загружаем…</span>
      {children}
    </div>
  );
}
