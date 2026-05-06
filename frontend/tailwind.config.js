/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#EEEEFA',
          100: '#DADAF3',
          200: '#B9B9E7',
          300: '#8E8ED7',
          400: '#6464C8',
          500: '#4A4AB8',
          600: '#333399',
          700: '#2B2B82',
          800: '#23236A',
          900: '#1A1A4F',
        },
        accent: {
          50: '#FFFBE8',
          100: '#FFF4C7',
          200: '#FFE88F',
          300: '#FFD543',
          400: '#FECB1E',
          500: '#FCB900',
          600: '#D79D00',
          700: '#A97900',
          800: '#7A5800',
          900: '#4F3900',
        },
        success: {
          50: '#eef9f0',
          100: '#d6efda',
          200: '#addfb6',
          300: '#7ac88c',
          400: '#49af63',
          500: '#2f944c',
          600: '#23763b',
          700: '#1d5f31',
          800: '#194b29',
          900: '#153d23',
        },
        ink: '#1F2937',
        mist: '#F8FAFC',
      },
      fontFamily: {
        sans: ['IBM Plex Sans', 'system-ui', 'sans-serif'],
        serif: ['Source Serif 4', 'serif'],
      },
    },
  },
  plugins: [],
}
