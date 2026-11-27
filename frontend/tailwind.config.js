/** @type {import('tailwindcss').Config} */
const token = (name) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Noto Sans',
          'Liberation Sans',
          'Ubuntu',
          'Cantarell',
          'sans-serif',
        ],
      },
      backgroundColor: {
        navegacion: token('--lateral-fondo-rgb'),
        white: token('--superficie-rgb'),
        slate: {
          50: token('--fondo-rgb'),
          100: token('--superficie-2-rgb'),
          200: token('--superficie-3-rgb'),
          300: token('--borde-rgb'),
          900: token('--texto-rgb'),
        },
        indigo: {
          50: token('--acento-suave-rgb'),
          100: token('--acento-suave-rgb'),
          200: token('--acento-borde-rgb'),
          600: token('--acento-rgb'),
          700: token('--acento-hover-rgb'),
        },
        blue: {
          50: token('--info-fondo-rgb'),
          200: token('--info-borde-rgb'),
        },
        amber: {
          50: token('--aviso-fondo-rgb'),
          100: token('--aviso-fondo-rgb'),
          200: token('--aviso-borde-rgb'),
        },
        red: {
          50: token('--peligro-fondo-rgb'),
          100: token('--peligro-fondo-rgb'),
          200: token('--peligro-borde-rgb'),
          600: token('--peligro-rgb'),
          700: token('--peligro-rgb'),
        },
        emerald: {
          50: token('--ok-fondo-rgb'),
          100: token('--ok-fondo-rgb'),
          200: token('--ok-borde-rgb'),
          600: token('--ok-rgb'),
        },
        violet: {
          50: token('--acento-suave-rgb'),
          200: token('--acento-borde-rgb'),
        },
      },
      textColor: {
        slate: {
          200: token('--lateral-texto-2-rgb'),
          300: token('--texto-2-rgb'),
          400: token('--texto-3-rgb'),
          500: token('--texto-3-rgb'),
          600: token('--texto-2-rgb'),
          700: token('--texto-2-rgb'),
          800: token('--texto-rgb'),
          900: token('--texto-rgb'),
        },
        indigo: {
          200: token('--acento-borde-rgb'),
          300: token('--acento-texto-rgb'),
          500: token('--acento-texto-rgb'),
          600: token('--acento-texto-rgb'),
          700: token('--acento-texto-rgb'),
        },
        blue: {
          600: token('--info-rgb'),
          700: token('--info-rgb'),
          900: token('--info-rgb'),
        },
        amber: {
          600: token('--aviso-rgb'),
          700: token('--aviso-rgb'),
          800: token('--aviso-rgb'),
          900: token('--aviso-rgb'),
        },
        red: {
          600: token('--peligro-rgb'),
          700: token('--peligro-rgb'),
          800: token('--peligro-rgb'),
          900: token('--peligro-rgb'),
        },
        emerald: {
          600: token('--ok-rgb'),
          700: token('--ok-rgb'),
          800: token('--ok-rgb'),
        },
        violet: {
          700: token('--acento-texto-rgb'),
        },
      },
      borderColor: {
        slate: {
          100: token('--borde-rgb'),
          200: token('--borde-rgb'),
          300: token('--borde-fuerte-rgb'),
          400: token('--borde-fuerte-rgb'),
        },
        indigo: {
          200: token('--acento-borde-rgb'),
          300: token('--acento-borde-rgb'),
        },
        blue: {
          200: token('--info-borde-rgb'),
        },
        amber: {
          200: token('--aviso-borde-rgb'),
        },
        red: {
          200: token('--peligro-borde-rgb'),
        },
        emerald: {
          200: token('--ok-borde-rgb'),
          300: token('--ok-borde-rgb'),
        },
      },
      ringColor: {
        indigo: {
          200: token('--acento-borde-rgb'),
          500: token('--acento-rgb'),
        },
        slate: {
          200: token('--borde-rgb'),
          300: token('--borde-fuerte-rgb'),
          400: token('--texto-3-rgb'),
        },
        amber: {
          200: token('--aviso-borde-rgb'),
        },
        blue: {
          200: token('--info-borde-rgb'),
        },
        emerald: {
          200: token('--ok-borde-rgb'),
        },
        red: {
          200: token('--peligro-borde-rgb'),
          500: token('--peligro-rgb'),
        },
        violet: {
          200: token('--acento-borde-rgb'),
        },
      },
    },
  },
  plugins: [],
};
