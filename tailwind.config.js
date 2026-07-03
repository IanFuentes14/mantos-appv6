/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        mantos: {
          navy: '#1e3a5f',
          blue: '#3971b8',
          pale: '#eaf0fb',
          ink: '#0d1f35',
        },
      },
    },
  },
  plugins: [],
};
