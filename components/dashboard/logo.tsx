/**
 * Sin 'use client': es puro marcado, así que sirve igual desde un Server
 * Component (app/page.tsx, app/meta-ads/page.tsx) o desde uno de cliente
 * (app/login/login-form.tsx).
 *
 * `background="dark"` envuelve el logo en una placa oscura FIJA (no
 * depende del tema activo) — para logos de un solo color claro (ej. un SVG
 * blanco) que se vuelven invisibles en modo claro sin algo oscuro detrás.
 * Se controla desde Ajustes → General ("El logo es de un solo color claro").
 */
export function Logo({
  src,
  alt,
  background,
  className = '',
}: {
  src: string;
  alt: string;
  background: '' | 'dark';
  className?: string;
}) {
  if (!src) return null;

  if (background !== 'dark') {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} className={`w-auto object-contain ${className}`} />;
  }

  return (
    <span className={`inline-flex items-center justify-center rounded-md bg-zinc-900 px-2 py-1.5 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="h-full w-auto object-contain" />
    </span>
  );
}
