/** Files imported as text (`with { type: "text" }`): the bundler inlines them, so the CLI carries them. */
declare module "*.md" {
  const text: string;
  export default text;
}

declare module "*.svg" {
  const text: string;
  export default text;
}
