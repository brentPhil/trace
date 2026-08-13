/** Maximum accepted invoice-logo upload: one mebibyte. */
export const MAX_LOGO_BYTES = 1024 * 1024

/** The storage metadata types the backend accepts and the browser requests. */
export const ACCEPTED_LOGO_CONTENT_TYPES = ["image/png", "image/jpeg"] as const
export type LogoContentType = (typeof ACCEPTED_LOGO_CONTENT_TYPES)[number]

export const LOGO_INPUT_ACCEPT = ACCEPTED_LOGO_CONTENT_TYPES.join(",")

export function isAcceptedLogoContentType(
  value: string | undefined
): value is LogoContentType {
  return (ACCEPTED_LOGO_CONTENT_TYPES as ReadonlyArray<string>).includes(
    value ?? ""
  )
}
