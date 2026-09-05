export type AppTheme = "dark" | "light"

export const APP_THEME_COOKIE_NAME = "app.theme.v1"
export const APP_THEME_CHANNEL_NAME = "app.theme"
export const DEFAULT_APP_THEME: AppTheme = "dark"

export function parseAppTheme(value: string | undefined): AppTheme {
	return value === "light" || value === "dark" ? value : DEFAULT_APP_THEME
}
