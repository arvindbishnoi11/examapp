/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Brand: "Setu" indigo → violet, tuned for AA contrast on white.
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
          950: '#1e1b4b',
        },
        surface: {
          light: '#f8fafc',
          dark: '#020617',
        },
      },
      fontFamily: {
        sans: [
          'Inter var',
          'Inter',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Noto Sans',
          'sans-serif',
        ],
        display: ['"Plus Jakarta Sans"', 'Inter var', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 24px -12px rgba(15, 23, 42, 0.12)',
        'card-hover': '0 2px 4px rgba(15, 23, 42, 0.05), 0 18px 36px -18px rgba(15, 23, 42, 0.25)',
        float: '0 24px 48px -24px rgba(30, 27, 75, 0.45)',
      },
      borderRadius: {
        xl2: '1.15rem',
        xl3: '1.6rem',
      },
      // Tailwind 3 ships 3.5 but not 4.5; several icon sizes use it.
      spacing: {
        4.5: '1.125rem',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.97)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.55' },
        },
      },
      animation: {
        'fade-in': 'fade-in 180ms ease-out both',
        'slide-up': 'slide-up 220ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'scale-in': 'scale-in 160ms ease-out both',
        shimmer: 'shimmer 1.6s infinite',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      screens: {
        xs: '420px',
      },
    },
  },
  plugins: [],
};
