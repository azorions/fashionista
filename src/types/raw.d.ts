// Vite/vitest `?raw` imports, used by the taxonomy drift test to read the
// migration as a string without pulling Node globals into a React Native app.
declare module '*.sql?raw' {
  const content: string;
  export default content;
}
