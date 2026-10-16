import js from "@eslint/js"
import ts from "typescript-eslint"

export default ts.config(
	{ ignores: ["dist/**", ".stage/**", "test-results/**", "playwright-report/**"] },
	js.configs.recommended,
	ts.configs.recommended,
	{
		files: ["src/*.cjs"],
		languageOptions: { globals: { require: "readonly", module: "readonly" } },
		rules: { "@typescript-eslint/no-require-imports": "off" },
	},
	{
		rules: {
			"no-restricted-properties": [
				"error",
				{ property: "then", message: "Use async/await instead of Promise.then()." },
				{ property: "catch", message: "Use try/catch with await instead of Promise.catch()." },
				{ property: "finally", message: "Use try/finally with await instead of Promise.finally()." },
			],
		},
	},
)
