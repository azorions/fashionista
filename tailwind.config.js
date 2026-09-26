/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Card grounds. Deliberately NOT pure white: a #FFFFFF card makes white
        // garments vanish and makes every cutout edge read as pasted-on.
        canvas: { light: '#F6F4F1', dark: '#1B1A19' },
        hairline: { light: 'rgba(0,0,0,0.05)', dark: 'rgba(255,255,255,0.07)' },
      },
      borderRadius: { card: '20px' },
    },
  },
  plugins: [],
};
