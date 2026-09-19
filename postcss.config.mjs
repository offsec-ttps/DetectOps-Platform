const config = {
  plugins: {
    "@tailwindcss/postcss": {
      // Exclude non-source directories from Tailwind's content scanning
      content: {
        files: [
          "./src/**/*.{ts,tsx,js,jsx}",
        ],
      },
    },
  },
};

export default config;
