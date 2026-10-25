export const extensionConfig = {
  id: "kubohiroyasvgtext",
  slug: "svg-text",
  name: "SVG Text",
  description: "Responsive named-style SVG text actors for TurboWarp.",
  author: "Hiroya Kubo",
  license: "MPL-2.0",
  unsandboxed: true,
  blockIconURI: `data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><text x="21" y="38" font-family="system-ui, sans-serif" font-size="30" font-weight="700" text-anchor="middle" fill="#4C97FF">A</text><g fill="#59C059"><circle cx="31" cy="13" r="2.6"/><circle cx="39" cy="13" r="2.6"/></g></svg>',
  )}`,
} as const;
