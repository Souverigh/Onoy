/** «D» из логотипа (src/lib/brand-icon.tsx) — цветом текста, для кнопок и значков. */
export function LogoMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="96 96 320 320" aria-hidden="true">
      <path fill="currentColor" fillRule="evenodd" d="M136 112H248A144 144 0 0 1 248 400H136Z M200 176V336H248A80 80 0 0 0 248 176Z" />
    </svg>
  );
}
