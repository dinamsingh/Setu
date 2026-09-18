/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        setu: {
          navy: {
            DEFAULT: '#13264A',
            dark: '#0C1830',
            light: '#1B3566',
          },
          teal: {
            DEFAULT: '#0F7A7A',
            dark: '#0A5656',
            light: '#169E9E',
          },
          blue: {
            DEFAULT: '#1E63B7',
            light: '#3A80D2',
            dark: '#164C8E',
          },
          green: {
            DEFAULT: '#219469',
            light: '#2DB380',
            dark: '#186E4E',
            bg: '#EAF8F2',
          },
          amber: {
            DEFAULT: '#C47814',
            light: '#E68F1A',
            dark: '#9E5F0E',
            bg: '#FEF6EC',
          },
          red: {
            DEFAULT: '#C43C3C',
            light: '#E04E4E',
            dark: '#9A2E2E',
            bg: '#FDF2F2',
          },
          slate: {
            50: '#F8FAFC',
            100: '#F1F5F9',
            200: '#E2E8F0',
            300: '#CBD5E1',
            400: '#94A3B8',
            500: '#64748B',
            600: '#475569',
            700: '#334155',
            800: '#1E293B',
            900: '#0F172A',
          }
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
