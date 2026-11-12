## Welcome to Robozium

Robozium runs its agents on hosted models, so it needs **at least one provider API key** before projects can start. Setup takes about two minutes, all in this window.

Use the arrows beside the Robozium mark below to move through the steps.

Just exploring? Start Robozium in mock mode instead to try it with scripted replies and no keys.

---

## Already have your keys?

If you saved keys in Robozium before, on another computer or an earlier install, you have a `.env.encrypt` file. Open **HUD view → Environment**, drop it on **Key file** or choose **Browse file**, and enter the password you encrypted it with. Your keys load at once; no restart and nothing to type again.

No key file yet? Use the arrows to set up a key in a few steps.

---

## 1. Get an API key

**OpenRouter is required.** It runs the default model and project memory.

- [OpenRouter keys](https://openrouter.ai/settings/keys): create a key and add a little credit.

Optional extras:

- [Cerebras keys](https://cloud.cerebras.ai/): enables the *GPT-OSS-120B · Fast · Cerebras* model.
- [Groq keys](https://console.groq.com/keys): enables voice dictation with **Record**.

Copy the key; you paste it in the next step.

---

## 2. Add it in Environment

Open **HUD view → Environment**. Next to `OPENROUTER_API_KEY`, choose **Change**, paste your key as the value and choose **Apply**. **Secret** stays on for API keys.

Add `CEREBRAS_API_KEY` or `GROQ_API_KEY` the same way if you have them.

---

## 3. Encrypt and save

Enter a password, confirm it and choose **Encrypt and save**. Your keys are stored encrypted and work immediately; no restart needed.

After a later restart, the app asks for the password when it starts. Keep the password somewhere safe outside the Robozium folder. If you forget it, **Reset environment** removes the saved settings so you can start again.

---

## 4. Start your first run

Once the keys are saved, this guide disappears and **New Project** on **Runs Overview** starts your first run.

Everything a run makes stays in its project folder inside your hub folder, `~/Robozium-Hub` unless you chose another under **Environment → Hub folder**. During a run, the folder button in the top right corner opens that folder in your file manager.
