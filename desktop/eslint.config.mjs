import js from "@eslint/js"
import ts from "typescript-eslint"

export default ts.config(
	{ ignores: ["dist/**", ".stage/**", "test-results/**", "playwright-report/**"] },
	js.configs.recommended,
	ts.configs.recommended,
)
