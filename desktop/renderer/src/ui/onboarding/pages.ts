// Copied from web/app/components/hud/onboarding/pages.ts at af87bea.
// Adapted: adding keys starts from an existing key file, and illustrations are
// named for their CSS classes.
import type { AgentMessage } from "../run/AgentMessagePanel"

type OnboardingPage = Pick<AgentMessage, "id" | "content" | "illustration">

/** Static guide for a live start without saved settings or `.env`. */
export const ONBOARDING_PAGES: readonly OnboardingPage[] = [
	{
		id: "welcome",
		content: `## Welcome to Robozium

Robozium runs its agents on hosted models, so it needs **at least one provider API key** before projects can start. Setup takes about two minutes, all in this window.

Use the arrows beside the **A** below to move through the steps.

Just exploring? Start Robozium in mock mode instead to try it with scripted replies and no keys.`,
		illustration: { name: "keys", alt: "A key next to the Robozium window" },
	},
	{
		id: "key-file",
		content: `## Already have your keys?

If you saved keys in Robozium before, in the browser app or another install, you have a \`.env.encrypt\` file. Open **HUD view → Environment**, drop it on **Key file** and enter the password you encrypted it with. Your keys load at once; no restart and nothing to type again.

No key file yet? Use the arrows to set up a key in a few steps.`,
	},
	{
		id: "get-key",
		content: `## 1. Get an API key

**OpenRouter is required.** It runs the default model and project memory.

- [OpenRouter keys](https://openrouter.ai/settings/keys): create a key and add a little credit.

Optional extras:

- [Cerebras keys](https://cloud.cerebras.ai/): enables the *GPT-OSS-120B · Cerebras* model.
- [Groq keys](https://console.groq.com/keys): enables voice dictation with **Record**.

Copy the key; you paste it in the next step.`,
	},
	{
		id: "add-key",
		content: `## 2. Add it in Environment

Open **HUD view → Environment**. Next to \`OPENROUTER_API_KEY\`, choose **Change**, paste your key as the value and choose **Apply**. **Secret** stays on for API keys.

Add \`CEREBRAS_API_KEY\` or \`GROQ_API_KEY\` the same way if you have them.`,
	},
	{
		id: "save",
		content: `## 3. Encrypt and save

Enter a password, confirm it and choose **Encrypt and save**. Your keys are stored encrypted and work immediately; no restart needed.

After a later restart, choose **Secrets locked** in the header and enter the password to unlock them. Keep the password somewhere safe outside the Robozium folder. If you forget it, **Reset environment** removes the saved settings so you can start again.`,
		illustration: { name: "secrets", alt: "A padlock protecting saved API keys" },
	},
	{
		id: "done",
		content: `## 4. Start your first run

Once the keys are saved, this guide disappears and **New Project** on **Runs Overview** starts your first run.

Prefer files? A plain \`.env\` in the app's \`live\` folder (\`~/.config/Robozium/live\` when installed), copied from \`.env.example\`, also works and overrides saved settings after a restart.`,
	},
]
