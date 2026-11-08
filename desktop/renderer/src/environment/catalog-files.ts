// The files of a tool and skill folder that its robozium.json imports: the catalog, the
// example files it lists, and everything inside its listed packages except hidden entries
// (.venv, .git, .env) and compiled caches, since the backend installs each package's pinned
// requirements itself. Browse hands over every file of the folder and the catalog picks from
// them. A dropped folder is read through its directory handle, or its entry when Chromium
// offers no handle, and only the listed paths are opened, so a whole checkout with a virtual
// environment is never read. The backend validates the catalog itself; entries that cannot be
// found are left for it to reject.
import type { DropEvent } from "react-dropzone"

export const CATALOG_FILE = "robozium.json"

interface Catalog { packages: string[]; env: string[] }

interface Child { name: string; directory: boolean }

/** A folder of the dropped tree; a read of a missing or refused name rejects. */
interface Folder {
	file(name: string): Promise<File>
	folder(name: string): Promise<Folder>
	list(): Promise<Child[]>
}

/** Chromium offers the File System Access handle of a dropped item; TypeScript's DOM types leave it out. */
type DroppedItem = DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> }

/**
 * react-dropzone's file reader for the import row: the files the folder's catalog imports,
 * each with its path inside the folder as `webkitRelativePath`, as Browse reports it. Drag
 * events before the drop read nothing. Throws with the reason when the selection is not one
 * folder with a catalog.
 */
export async function catalogFiles(event: DropEvent | FileSystemFileHandle[]): Promise<File[]> {
	if (Array.isArray(event)) return []
	// Browse answers through the file input; a drop may land on any control of the row.
	if (event.type === "change" && event.target instanceof HTMLInputElement) return browsed(Array.from(event.target.files ?? []))
	const transfer = (event as { dataTransfer?: DataTransfer | null }).dataTransfer
	if (event.type !== "drop" || !transfer) return []
	const items = Array.from(transfer.items).filter(item => item.kind === "file")
	const entry = items.length === 1 ? items[0].webkitGetAsEntry() : null
	if (!entry?.isDirectory) throw new Error("Drop one folder.")
	const handle = await (items[0] as DroppedItem).getAsFileSystemHandle?.()
	const root = handle?.kind === "directory"
		? fromHandle(handle as FileSystemDirectoryHandle)
		: fromEntry(entry as FileSystemDirectoryEntry)
	return dropped(root, entry.name)
}

function parseCatalog(text: string): Catalog {
	let declared: unknown
	try {
		declared = JSON.parse(text)
	} catch {
		throw new Error(`${CATALOG_FILE} is not valid JSON`)
	}
	const paths = (key: string) => {
		const value = typeof declared === "object" && declared !== null ? (declared as Record<string, unknown>)[key] : undefined
		return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
	}
	return { packages: [...paths("tools"), ...paths("skills")], env: paths("env") }
}

const skipped = (name: string) => name.startsWith(".") || name === "__pycache__"

/** Whether the catalog imports the file at this path inside the folder. */
const listed = ({ packages, env }: Catalog, relative: string) =>
	relative === CATALOG_FILE || env.includes(relative)
	|| (packages.some(folder => relative.startsWith(`${folder}/`)) && !relative.split("/").some(skipped))

/** Gives a file read from a handle or entry its path inside the folder, as a browsed file has. */
function withPath(file: File, path: string): File {
	Object.defineProperty(file, "webkitRelativePath", { value: path })
	return file
}

async function browsed(files: File[]): Promise<File[]> {
	const relative = (file: File) => file.webkitRelativePath.split("/").slice(1).join("/")
	const catalog = files.find(file => relative(file) === CATALOG_FILE)
	if (!catalog) throw new Error(`${CATALOG_FILE} is missing at the folder root`)
	const declared = parseCatalog(await catalog.text())
	return files.filter(file => listed(declared, relative(file)))
}

async function dropped(root: Folder, name: string): Promise<File[]> {
	const catalog = await found(root.file(CATALOG_FILE))
	if (!catalog) throw new Error(`${CATALOG_FILE} is missing at the folder root`)
	const { packages, env } = parseCatalog(await catalog.text())
	const files = [withPath(catalog, `${name}/${CATALOG_FILE}`)]
	for (const path of env) {
		const file = await found(fileAt(root, path))
		if (file) files.push(withPath(file, `${name}/${path}`))
	}
	for (const path of packages) {
		const folder = await found(descend(root, path.split("/")))
		if (folder) await collect(folder, `${name}/${path}`, files)
	}
	return files
}

/** Chromium refuses some reads, which fail the drop; any other failure leaves the path to the backend to name. */
async function found<T>(read: Promise<T>): Promise<T | null> {
	try {
		return await read
	} catch (error) {
		if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) throw error
		return null
	}
}

async function fileAt(root: Folder, path: string): Promise<File> {
	const parts = path.split("/")
	return (await descend(root, parts.slice(0, -1))).file(parts[parts.length - 1])
}

async function descend(folder: Folder, parts: string[]): Promise<Folder> {
	for (const part of parts) folder = await folder.folder(part)
	return folder
}

/** Every file inside a listed package, hidden entries and compiled caches left unopened. */
async function collect(folder: Folder, path: string, files: File[]): Promise<void> {
	for (const { name, directory } of await folder.list()) {
		if (skipped(name)) continue
		if (directory) await collect(await folder.folder(name), `${path}/${name}`, files)
		else files.push(withPath(await folder.file(name), `${path}/${name}`))
	}
}

function fromHandle(handle: FileSystemDirectoryHandle): Folder {
	return {
		file: async name => (await handle.getFileHandle(name)).getFile(),
		folder: async name => fromHandle(await handle.getDirectoryHandle(name)),
		list: async () => {
			const children: Child[] = []
			for await (const child of handle.values()) children.push({ name: child.name, directory: child.kind === "directory" })
			return children
		},
	}
}

function fromEntry(entry: FileSystemDirectoryEntry): Folder {
	return {
		file: name => new Promise((resolve, reject) =>
			entry.getFile(name, {}, child => (child as FileSystemFileEntry).file(resolve, reject), reject)),
		folder: name => new Promise((resolve, reject) =>
			entry.getDirectory(name, {}, child => resolve(fromEntry(child as FileSystemDirectoryEntry)), reject)),
		list: () => new Promise((resolve, reject) => {
			const reader = entry.createReader()
			const children: Child[] = []
			// Each call answers a batch; an empty one ends the listing.
			const next = () => reader.readEntries(batch => {
				if (batch.length === 0) return resolve(children)
				children.push(...batch.map(child => ({ name: child.name, directory: child.isDirectory })))
				next()
			}, reject)
			next()
		}),
	}
}
