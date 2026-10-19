import type { AgentMessage } from "../run/AgentMessagePanel"

type OnboardingPage = Pick<AgentMessage, "id" | "content" | "illustration">

/** Static guide for a live start without `.env` or `.env.encrypt`. */
export const ONBOARDING_PAGES: readonly OnboardingPage[] = [
	{
		id: "welcome",
		content: `## Welcome to Robozium

Robozium runs its agents on hosted models, so it needs **at least one provider API key** before projects can start. Setup takes about two minutes and happens entirely in this folder; no other documentation is needed.

Use the arrows beside the **A** below to move through the steps.

Just exploring? Stop Robozium with **Ctrl+C** and run \`./start --mock\` (\`start.cmd --mock\` on Windows) to try it with scripted replies and no keys.`,
		illustration: { src: "/onboarding/keys.svg", alt: "A key next to the Robozium window" },
	},
	{
		id: "get-key",
		content: `## 1. Get an API key

**OpenRouter is required.** It runs the default model and project memory.

- [OpenRouter keys](https://openrouter.ai/settings/keys): create a key and add a little credit.

Optional extras:

- [Cerebras keys](https://cloud.cerebras.ai/): enables the *GPT-OSS-120B · Cerebras* model.
- [Groq keys](https://console.groq.com/keys): enables voice dictation with **Record**.

Keep each key somewhere safe; you paste it into a file in the next steps.`,
	},
	{
		id: "create-env",
		content: `## 2. Create your \`.env\` file

Stop Robozium in its terminal with **Ctrl+C**, then copy the example settings file in the folder you cloned:

\`\`\`sh
cp .env.example .env
\`\`\`

On Windows:

\`\`\`bat
copy .env.example .env
\`\`\``,
		illustration: { src: "/onboarding/env-file.svg", alt: "The .env.example file copied to .env in the robozium folder" },
	},
	{
		id: "paste-key",
		content: `## 3. Paste your key

Open \`.env\` in any text editor and put your key after the equals sign:

\`\`\`sh
OPENROUTER_API_KEY=sk-or-v1-…
\`\`\`

Add \`CEREBRAS_API_KEY\` or \`GROQ_API_KEY\` the same way if you have them, and leave unused lines empty. Save the file.

Git ignores \`.env\`, but any program with access to the folder can still read it.`,
		illustration: { src: "/onboarding/env-edit.svg", alt: "A text editor showing OPENROUTER_API_KEY set in .env" },
	},
	{
		id: "restart",
		content: `## 4. Restart Robozium

Start it again from the same folder, without \`--mock\`:

\`\`\`sh
./start
\`\`\`

On Windows, run \`start.cmd\`. Reload this page when it is ready. This guide disappears and **New Project** starts your first run.`,
		illustration: { src: "/onboarding/restart.svg", alt: "A terminal running ./start" },
	},
	{
		id: "encrypt",
		content: `## Optional: encrypt your keys

Once Robozium is running with your keys, you can store them encrypted instead of in plain text. Do this before giving a coding agent access to the folder.

1. Open **HUD view → Environment**. For each key, enter its value, mark it **Secret** and choose **Apply**, then **Encrypt and save** with a password.
2. Delete \`.env\` and restart with \`./start\`.
3. Choose **Secrets locked** in the HUD header and enter the password.

Keep the password outside the folder. If you forget it, **Reset environment** removes the saved settings so you can start again.`,
		illustration: { src: "/onboarding/secrets.svg", alt: "A padlock protecting .env.encrypt" },
	},
]
