const versionLabel = document.querySelector<HTMLParagraphElement>("#version")
if (!versionLabel) throw new Error("The application version element is missing.")

async function showVersion(label: HTMLParagraphElement): Promise<void> {
	try {
		const version = await window.robozium.getVersion()
		label.textContent = `Version ${version}`
	} catch {
		label.setAttribute("role", "alert")
		label.textContent = "Unable to read the application version."
	}
}

void showVersion(versionLabel)
