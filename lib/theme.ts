'use client';

// El dashboard usa el sistema de temas del proyecto (next-themes + variables
// CSS de shadcn). Para todo lo que se pinta con clases de Tailwind se usan
// las clases semánticas (bg-background, text-muted-foreground, …).
//
// Recharts es la excepción: pinta el color directo en el SVG y NO reacciona
// a clases de Tailwind. Para esos casos este módulo expone `useGrays()`, que
// devuelve la escala correcta según el tema activo (resolvedTheme).

import { useTheme } from 'next-themes';

export const ACCENT = '#53958B'; // acento corporativo — fijo en ambos modos

// Semáforo verde/amarillo/rojo — colores fijos, legibles sobre fondo claro
// y oscuro, no dependen del tema.
export const SEMAFORO = {
  green: '#22C55E',
  yellow: '#EAB308',
  red: '#EF4444',
} as const;

export type GrayScale = Record<950 | 900 | 800 | 700 | 600 | 500 | 400 | 200 | 100, string>;

// Escala para MODO OSCURO — los mismos hex que usaba el dashboard antes.
const DARK_GRAYS: GrayScale = {
  950: '#09090B', // fondo de página
  900: '#18181B', // fondo de tarjetas
  800: '#27272A', // bordes / divisores
  700: '#3F3F46', // superficies secundarias
  600: '#52525B', // categoría "Otro" en gráficas
  500: '#71717A', // texto muted
  400: '#A1A1AA', // texto secundario sobre fondo oscuro
  200: '#D4D4D8',
  100: '#F4F4F5', // texto principal sobre fondo oscuro
};

// Escala para MODO CLARO — invierte los roles: los índices altos (100) pasan
// a ser texto oscuro, los bajos (950/900) pasan a ser fondo casi blanco. El
// texto secundario (400) se oscurece más de lo que sería un simple inverso
// para no perder legibilidad sobre blanco.
const LIGHT_GRAYS: GrayScale = {
  950: '#FFFFFF', // fondo de página
  900: '#FFFFFF', // fondo de tarjetas
  800: '#E4E4E7', // bordes / divisores
  700: '#D4D4D8', // superficies secundarias
  600: '#A1A1AA', // categoría "Otro" en gráficas
  500: '#71717A', // texto muted
  400: '#52525B', // texto secundario sobre fondo claro (más oscuro a propósito)
  200: '#3F3F46',
  100: '#18181B', // texto principal sobre fondo claro
};

/**
 * Escala de grises para el tema activo. Solo para componentes cliente que
 * pintan color directo en SVG (recharts) — el resto usa clases semánticas.
 * Antes de montar (resolvedTheme === undefined) cae a la escala clara, que
 * coincide con el defaultTheme="light" del ThemeProvider.
 */
export function useGrays(): GrayScale {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === 'dark' ? DARK_GRAYS : LIGHT_GRAYS;
}

/** @deprecated Usa `useGrays()` — este alias apunta siempre a la escala oscura. */
export const GRAYS = DARK_GRAYS;
