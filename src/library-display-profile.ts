/** Display-only settings shared by a Library's list and cover gallery. */
export interface LibraryDisplayProfile {
  layout: "list" | "cards";
  imageProperty: string;
  cardSize: "small" | "medium" | "large";
  imageRatio: "portrait" | "square" | "landscape";
  imageFit: "contain" | "cover";
  visibleProperties: string[];
}

export type LibraryDisplayProfiles = Record<string, LibraryDisplayProfile>;
export const MAX_LIBRARY_DISPLAY_PROPERTY_LENGTH = 128;
export const MAX_LIBRARY_VISIBLE_PROPERTIES = 6;
export const DEFAULT_LIBRARY_DISPLAY_PROFILE: Readonly<LibraryDisplayProfile> = {
  layout: "list",
  imageProperty: "cover",
  cardSize: "medium",
  imageRatio: "portrait",
  imageFit: "contain",
  visibleProperties: ["author", "reading_status"],
};

/** Property names are plain own-property keys, never a path or executable expression. */
export function cleanLibraryDisplayProperty(input: unknown): string | null {
  if (typeof input !== "string" || input.length > MAX_LIBRARY_DISPLAY_PROPERTY_LENGTH) return null;
  const property = input.normalize("NFC").trim();
  if (!property || property.length > MAX_LIBRARY_DISPLAY_PROPERTY_LENGTH || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(property)
    || property === "prototype" || Object.prototype.hasOwnProperty.call(Object.prototype, property)) return null;
  return property;
}

/** Return a fresh bounded profile; missing/invalid fields inherit the list defaults. */
export function normalizeLibraryDisplayProfile(input: unknown): LibraryDisplayProfile {
  const value = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown> : {};
  const own = (key: string): unknown => Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;
  const rawProperties = own("visibleProperties");
  const visibleProperties: string[] = [];
  if (Array.isArray(rawProperties)) {
    // Bound inspection as well as output, including a malicious list of empty values.
    for (const raw of rawProperties.slice(0, MAX_LIBRARY_VISIBLE_PROPERTIES)) {
      const property = cleanLibraryDisplayProperty(raw);
      if (property && !visibleProperties.includes(property)) visibleProperties.push(property);
    }
  } else visibleProperties.push(...DEFAULT_LIBRARY_DISPLAY_PROFILE.visibleProperties);
  const cardSize = own("cardSize");
  const imageRatio = own("imageRatio");
  return {
    layout: own("layout") === "cards" ? "cards" : "list",
    imageProperty: cleanLibraryDisplayProperty(own("imageProperty")) ?? DEFAULT_LIBRARY_DISPLAY_PROFILE.imageProperty,
    cardSize: cardSize === "small" || cardSize === "large" ? cardSize : "medium",
    imageRatio: imageRatio === "square" || imageRatio === "landscape" ? imageRatio : "portrait",
    imageFit: own("imageFit") === "cover" ? "cover" : "contain",
    visibleProperties,
  };
}

/** Strict interactive boundary; normalization remains forgiving for older persisted data. */
export function validateLibraryDisplayProfile(input: unknown): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "Library display settings must be an object.";
  const value = input as Record<string, unknown>;
  const allowed = new Set(["layout", "imageProperty", "cardSize", "imageRatio", "imageFit", "visibleProperties"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return "Library display settings contain an unsupported field.";
  for (const [key, options] of [
    ["layout", ["list", "cards"]],
    ["cardSize", ["small", "medium", "large"]],
    ["imageRatio", ["portrait", "square", "landscape"]],
    ["imageFit", ["contain", "cover"]],
  ] as const) {
    if (Object.prototype.hasOwnProperty.call(value, key) && !(options as readonly unknown[]).includes(value[key])) {
      return `Choose a supported ${key} option.`;
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, "imageProperty") && !cleanLibraryDisplayProperty(value.imageProperty)) {
    return `The image property must be a valid property name of at most ${MAX_LIBRARY_DISPLAY_PROPERTY_LENGTH} characters.`;
  }
  if (Object.prototype.hasOwnProperty.call(value, "visibleProperties")) {
    if (!Array.isArray(value.visibleProperties) || value.visibleProperties.length > MAX_LIBRARY_VISIBLE_PROPERTIES) {
      return `Choose at most ${MAX_LIBRARY_VISIBLE_PROPERTIES} visible properties.`;
    }
    if (value.visibleProperties.some((property) => !cleanLibraryDisplayProperty(property))) {
      return "Visible properties must use valid property names.";
    }
  }
  return null;
}
